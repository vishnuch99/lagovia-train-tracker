# Lagovia Train Tracker

A live train departure board that searches Belgian stations by name and shows upcoming departures within the next 15 minutes. Data is sourced from [iRail](https://docs.irail.be/), the open Belgian railway API.

---

## How to Install and Run

### Prerequisites
- Node.js ≥ 18 (`node -v` to check)
- npm ≥ 9

### Install dependencies

```bash
# From the project root:
npm install            # installs concurrently for the root dev script
npm run install:all    # installs backend and frontend dependencies
```

Or install them separately:
```bash
cd backend && npm install
cd ../frontend && npm install
```

### Run in development

```bash
# From the project root — starts both servers with colour-coded output:
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

Or run them in separate terminals:
```bash
cd backend && npm run dev     # nodemon — auto-restarts on file changes
cd frontend && npm run dev    # Vite dev server with HMR
```

---

## API Reference

### `GET /departures?q=<query>`

Returns upcoming departures (next 15 minutes) from every station whose name contains `<query>` as a substring, with fuzzy fallback for typos.

**Query constraints:**
- Fewer than 3 characters → `400 QUERY_TOO_SHORT`

**Success response (`200 OK`):**
```json
{
  "query": "Bru",
  "generatedAt": "2024-01-15T14:32:00.000Z",
  "stations": [
    {
      "stationId": "BE.NMBS.008814001",
      "stationName": "Brussels-Central",
      "departures": [
        {
          "trainNumber": "IC3033",
          "destination": "Liège-Guillemins",
          "scheduledTime": "14:35",
          "scheduledTimestamp": 1705329300,
          "delayMinutes": 5,
          "cancelled": false,
          "platform": "3"
        }
      ]
    }
  ]
}
```

**Error responses:**
```json
{ "error": "Input is incomplete", "code": "QUERY_TOO_SHORT" }
{ "error": "Query is too long", "code": "QUERY_TOO_LONG" }
{ "error": "Failed to reach the iRail upstream API", "code": "UPSTREAM_ERROR" }
```

**Health check:** `GET /health` → `{ "status": "ok" }`

---

## Decisions, Trade-offs, and Known Limitations

### Architecture

The app is split into a Node.js/Express backend and a React frontend. The backend acts as a proxy to iRail for two reasons: (1) iRail does not send CORS headers, so browsers cannot call it directly; (2) keeping API logic on the server means the client stays dumb — it only renders what it receives.

### Station caching

The full station list (~600 entries) is fetched from iRail once and cached in memory for 10 minutes. The list changes very rarely (new stations are opened every few years), so a 10-minute TTL is a reasonable trade-off between freshness and unnecessary API calls. A production system would use Redis; for this scope, a module-level variable is sufficient.

### Parallel liveboard fetches with `Promise.all`

Searching "Bru" can match 5–10 stations. Rather than fetching them sequentially, we launch all liveboard requests concurrently with `Promise.all`. Each per-station fetch is wrapped in its own `try/catch`, so a single station failure never rejects the outer `Promise.all` — the UI shows a per-station error note while still displaying results for all other stations.

### Fuzzy search

Substring matching satisfies the spec. Fuzzy matching (bonus requirement) is layered on top using [Fuse.js](https://fusejs.io/): results that don't match by substring are checked against a fuzzy index and appended. The threshold (0.35) was chosen to catch common typos without producing wildly irrelevant results.

### Departure window filtering

Departures are filtered by **scheduled** time (not actual = scheduled + delay), as the spec states "departures scheduled within the next 15 minutes." Trains already departed (`left === '1'`) are excluded regardless of their scheduled time.

### Frontend state management

All state lives in `App.jsx` and is passed to children as props. React Context or a state manager (Zustand, Redux) would be overkill for an app with one screen and three pieces of state.

### Styling

Tailwind CSS v3 is used directly rather than adding the full shadcn/ui tooling layer. shadcn/ui is built on Tailwind + Radix UI; using Tailwind directly achieves the same visual result without the interactive setup steps and generated file overhead.

### Known Limitations

- **No pagination:** If a search matches 30 stations, all are fetched and shown. In practice this is rare, but a busy query could generate many parallel iRail calls.
- **No rate-limit handling:** iRail documents rate limits (3 req/s, burst of 5) but does not enforce them in practice. The backend makes all liveboard requests concurrently with no throttling. If limits were enforced, the backend would return a 502 UPSTREAM_ERROR.
- **Station cache is per-process:** Multiple backend instances would each maintain their own cache. A shared cache (Redis) would be needed for horizontal scaling.
- **Time zone assumption:** Scheduled times are formatted in `Europe/Brussels`. If iRail ever returns timestamps in a different zone, this would show incorrect times.
