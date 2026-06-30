# Lagovia Train Tracker

A live train departure board that searches Belgian stations by name and shows upcoming departures within the next 15 minutes. Data is sourced from [iRail](https://docs.irail.be/), the open Belgian railway API.

---

## my_version vs main

This branch (`my_version`) extends the `main` submission with several production-oriented improvements. The core search and display logic is the same; the differences are in how data flows between the layers.

- **SSE streaming** — instead of waiting for all liveboards to resolve and returning one JSON response, the backend streams each station as a `text/event-stream` event the moment its liveboard resolves. The frontend renders cards progressively as they arrive.
- **Auto-submit with debounce** — no Submit button. Search fires automatically 400ms after the user stops typing (minimum 3 characters). The input field is the only control needed.
- **Token-bucket rate limiter** — the backend paces iRail requests to 2 req/s with a burst of 5, matching iRail's documented limits, so the app stays within bounds even when a query matches many stations.
- **Exponential-backoff retry** — if the connection drops before any data arrives, the frontend retries up to 3 times (1s → 2s → 4s with jitter) before showing an error.
- **Request deduplication** — concurrent requests for the same station share one in-flight Promise; the second caller gets the same result without firing a second iRail call.

---


### Hosted Website
To run the hosted deployment on GitHub pages + Vercel, go to https://vishnuch99.github.io/lagovia-train-tracker/.

## How to Install and Run Locally

### Prerequisites
- Node.js ≥ 18 (`node -v` to check)
- npm ≥ 9

### Install dependencies

```bash
# From the project root:
npm install            # installs concurrently for the root dev script
npm run install:all    # installs backend and frontend dependencies
```

### Run

```bash
# From the project root — starts both backend and frontend:
npm run dev
```

Once the servers are up and running, open `http://localhost:5173` to access the demo. 

---

## API Reference

### `GET /departures?q=<query>`

Returns upcoming departures (next 15 minutes) from every station whose name contains `<query>` as a substring, with fuzzy fallback for typos.

**Query constraints:**
- Fewer than 3 characters → `400 QUERY_TOO_SHORT` (JSON, before stream opens)
- More than 100 characters → `400 QUERY_TOO_LONG` (JSON, before stream opens)

**Success response (`200 OK` — `text/event-stream`):**

The response is a stream of newline-delimited JSON events. Events arrive as stations resolve — the client does not wait for all of them.

```
Content-Type: text/event-stream

data: {"type":"meta","query":"Bru","generatedAt":"2024-01-15T14:32:00.000Z","totalStationsMatched":3}

data: {"type":"station","stationId":"BE.NMBS.008814001","stationName":"Brussels-Central","departures":[{"trainNumber":"IC3033","destination":"Liège-Guillemins","scheduledTime":"14:35","scheduledTimestamp":1705329300,"delayMinutes":5,"cancelled":false,"platform":"3"}]}

data: {"type":"station","stationId":"BE.NMBS.008821006","stationName":"Brussels-North","departures":[],"fetchError":"Could not load departures for this station"}

data: {"type":"done"}
```

If iRail is unreachable after the stream has already opened, the server emits an error event instead of closing with an HTTP error code:
```
data: {"type":"error","error":"Failed to reach the iRail upstream API","code":"UPSTREAM_ERROR"}
```

**Error responses (before stream opens):**
```json
{ "error": "Input is incomplete", "code": "QUERY_TOO_SHORT" }
{ "error": "Query is too long", "code": "QUERY_TOO_LONG" }
```

---


## Architecture

![Architecture diagram](./architecture_diagram.png)

The app uses the following frameworks for each of the components.

| Component                        | Framework / Library             |
|----------------------------------|---------------------------------|
| Frontend UI                      | React                           |
| Frontend build & dev server      | Vite                            |
| Styling                          | Tailwind CSS                    |
| Icons                            | Lucide React                    |
| Backend server                   | Express                         |
| HTTP client                      | Axios                           |
| Fuzzy search                     | Fuse.js                         |
| Tests                            | Vitest + Supertest              |

### Sequence Diagram

![Sequence diagram](./sequence_diagram.png)
1. Express backend prefetches the list of stations and caches them in memory for 10 minutes.
2. User types in the browser; after 400ms of inactivity (debounce) the React hook auto-submits — no Submit button required.
3. React hook opens a GET /departures?q=Bru SSE connection to Express.
4. Using the cached stations list, Express finds the list of stations that contain the query in their name / standard name.
5. If there are no direct substring matches, Express checks for fuzzy matching.
6. Express fires parallel requests to iRail to fetch the liveboards of each matching station. Each request passes through a token-bucket rate limiter (2 req/s, burst of 5) to respect iRail's documented limits.
7. Each liveboard response is cached and filtered. The data is held in cache for 15 seconds.
8. In-flight deduplication prevents multiple concurrent requests for the same station — any second caller waits on the existing Promise rather than firing a new iRail call.
9. Each station is emitted as an SSE `station` event the moment its liveboard resolves. Any per-station failure is emitted as a `station` event with a `fetchError` field rather than aborting the stream.
10. As each `station` event arrives, the card is rendered immediately — results appear progressively while remaining stations are still loading.
11. Each station's departures are sorted by scheduled time. Station cards are sorted by earliest departure; stations with no departures or errors sink to the bottom.
12. If the connection drops before any data arrives, the frontend retries up to 3 times with exponential backoff (1s → 2s → 4s with jitter) before showing an error.
13. After 15 seconds from when streaming completes, the Refresh button appears to allow the user to fetch fresh data.
14. On clearing the search box, the previous results disappear and the app is ready for a new query.

## Decisions and Tradeoffs

### Caching strategy

1. The full station list (~714 entries) is prefetched by the Express backend from iRail and cached in memory for 10 minutes. 
- Since this is a prerequisite that rarely changes for any user query, the slight tradeoff of prefetching and caching should essentially be ignored.

2. When a user submits a query, the liveboard of every matching station is fetched in parallel and cached in memory for 15 seconds.
- This keeps the backend from hitting the iRail API repeatedly and prevents redundant information. 
- Since the departure time is expressed in HH:MM, a TTL of 15 seconds keeps data reasonably fresh.
- A periodic interval job that runs every 15 seconds removes all the stale entries in cache.

### Parallel liveboard fetches with SSE progressive streaming

Rather than fetching liveboards from iRail sequentially, all requests are launched concurrently using `Promise.allSettled`.
- `Promise.allSettled` (not `Promise.all`) ensures a single station failure never aborts the others — each station is wrapped in its own `try/catch` and emitted as a `station` event with a `fetchError` field, while all other stations continue streaming normally.
- Each station is emitted as an SSE event the moment its liveboard resolves, so the frontend can render cards progressively instead of waiting for the slowest station.
- A token-bucket rate limiter (2 req/s sustained, burst of 5) paces requests before they reach iRail, matching iRail's [documented limits](https://docs.irail.be/#header-request-limits). Stations with cache hits arrive immediately; rate-limited requests stream in at ~2/s thereafter. On a 429 response, the limiter applies a 2-second penalty to all queued callers before retrying.

### Display actual upcoming departures, not scheduled

Departures are filtered by **actual** time (not scheduled) by taking the delay into account. Thus, trains that are scheduled to leave before the time right now but have not left because of a delay will be displayed. Trains that already departed are excluded regardless of their scheduled or actual time.

### Bonus - Fuzzy search

Substring matching satisfies the spec. Fuzzy matching (bonus requirement) is layered on top using [Fuse.js](https://fusejs.io/): results that don't match by substring are checked against a fuzzy index and appended. The threshold (0.35) was chosen to catch common typos without producing wildly irrelevant results.

### Known Limitations

- **Time zone assumption:** Scheduled times are formatted in `Europe/Brussels`. If iRail ever returns timestamps in a different zone, this would show incorrect times.
- **No defensive validation of upstream data:** The application treats iRail as a trusted API and assumes documented response fields and reasonable payload sizes. It does not implement defensive measures such as maximum station name lengths, maximum station counts, or schema validation of upstream responses.

## Alternative Approach

The `my_version` branch (this branch) is my alternative implementation. It adds SSE streaming, auto-submit with debounce, a token-bucket rate limiter, and exponential-backoff retry on top of the core search logic.

The `main` branch is my official submission and intentionally follows the assessment requirements as closely as possible: a single synchronous JSON endpoint with no rate limiter, no retry logic, and an explicit Submit button.

I chose `main` as the primary submission because the assessment explicitly requests a single JSON endpoint, and I wanted the official submission to align as closely as possible with the stated requirements. The changes in `my_version` represent what I would build for a production deployment.
