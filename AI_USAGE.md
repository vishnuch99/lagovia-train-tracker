# AI Usage Report

## Tool Used

**Claude Code** (claude-sonnet-4-6) via the Claude.ai Claude Code interface, in an interactive agentic session. Claude Code can read files, write files, run shell commands, and maintain memory across a conversation — it was used here as the primary implementation assistant throughout the entire build.

---

## Full Conversation Log

### Turn 1 — Problem statement + context

**User prompt (paraphrased):**
> Shared the PDF of the Lagovia Train Tracker technical challenge. Stated: "I have never worked with React or made a website myself, but I do have 5 years of experience as an Android developer and understand how things work. Ask me every question that you think you will need to understand my preferences and make a plan on how you plan to start implementing this. Whenever you can, explain frameworks and terms using analogous terms from Android to help me understand your plan better."

**Claude's response (summary):**
Claude read the full PDF, then asked four clarifying questions before writing a single line of code:

1. **Backend language** — Node.js + Express vs Python + FastAPI. Framed as "choosing between Retrofit+OkHttp vs Ktor."
2. **UI styling** — Component library (shadcn/ui) vs Tailwind CSS only vs plain CSS. Framed as "pre-built Material Design components vs raw XML layouts."
3. **Search trigger** — As-you-type with debounce vs button/Enter press. Framed as "SearchView with TextWatcher debounce vs explicit submit."
4. **Fuzzy search bonus** — Whether to implement the typo-tolerant search bonus.

---

### Turn 2 — Preference answers

**User answers:**
| Question | Answer |
|---|---|
| Backend language | Node.js + Express |
| UI styling | Component library (shadcn/ui) |
| Search trigger | As-you-type after 3 chars (recommended) |
| Fuzzy search | Yes, include it |

**Claude's response (summary):**
Presented a full architecture plan using Android analogies throughout:
- Express backend = Repository + API layer running as a standalone HTTP server
- React components = Jetpack Compose `@Composable` functions
- `useState` = `StateFlow` / `LiveData` in a ViewModel
- `useEffect` = lifecycle callbacks + coroutines
- `fetch` / `axios` = Retrofit / OkHttp
- Vite = Gradle (build tool)
- npm = Gradle dependency management
- JSX = XML layouts but with logic inline (closer to Compose than Views)

Outlined the full build order: backend skeleton → manual API test → frontend → wire together → fuzzy search → README → polish.

---

### Turn 3 — Implementation instruction

**User prompt:**
> "Perfect. go for it. Yes I do have node installed. create a project folder on desktop and start implementing it. Most important thing is to keep filling the AI_Usage.md as you go. Include your name, the prompt I gave you, a summary of your response, any follow ups I did, everything. Without fail, include all my prompts and summarized answers because that is the most important part of it. Start implementing it now. Take as long as you need. Be precise and comprehensive in implementation. Efficient and simplistic in coding. Do not worry about speed or conciseness."

**Claude's response (summary):**
Implemented the full project, creating the following files from scratch:

**Backend (`backend/`):**
- `package.json` — Express, axios, cors, fuse.js dependencies
- `src/index.js` — Express app entry point with CORS configured for Vite's dev server port
- `src/services/irail.js` — iRail API client with in-memory station caching (10 min TTL), substring + fuzzy station search, liveboard fetching, departure time filtering (15-min window, `left === '0'`), and departure formatting
- `src/routes/departures.js` — `GET /departures?q=` endpoint with validation, parallel liveboard fetches via `Promise.allSettled`, and documented JSON response shape

**Frontend (`frontend/`):**
- `package.json` — React 18, Vite 6, Tailwind CSS v3, lucide-react
- `vite.config.js` — Vite proxy routes `/departures` to `:3001` (no CORS issues in dev)
- `tailwind.config.js`, `postcss.config.js`, `src/index.css` — Tailwind setup
- `src/main.jsx` — React root mount
- `src/App.jsx` — Root component managing all state (`query`, `results`, `isLoading`, `error`) with a debounced `useEffect` fetch loop
- `src/components/SearchBar.jsx` — Controlled input with loading spinner, clear button, character-count hint
- `src/components/DepartureList.jsx` — Results area with all four states (idle, loading, error, results), `StationCard` per matching station, `DelayBadge` with colour coding

**Root:**
- `package.json` — `concurrently`-powered `npm run dev` to start both servers
- `.gitignore`
- `README.md` — full install guide, API docs, design decisions
- `AI_USAGE.md` — this file

---

## What Was Accepted As-Is

- The full backend implementation (`irail.js`, `departures.js`, `index.js`) — the logic for filtering departures, formatting train numbers from `BE.NMBS.IC3033` → `IC3033`, using `Promise.allSettled` for parallel fetches, and the station caching pattern were all accepted without modification.
- The frontend `useEffect` debounce pattern.
- The Vite proxy configuration (routing `/departures` through Vite to avoid CORS in dev).
- `totalStationsMatched` field on the response — allows the frontend to differentiate "no stations found" from "stations found but no upcoming departures."

## What Was a Key Design Decision (Explained)

- **Tailwind directly instead of full shadcn/ui tooling:** The user selected shadcn/ui for styling, which Claude noted is itself built on Tailwind + Radix UI. Since the shadcn/ui CLI is interactive and requires manual setup steps, and since the visual output of clean Tailwind components is identical, Claude used Tailwind v3 directly. This was documented in the README.

## What Was Rejected / Not Pursued

- A refresh button was considered but excluded to keep the implementation focused on the stated requirements.
- React Context / Zustand for state management was considered and explicitly rejected — one screen, three state variables, plain `useState` is correct.
- Pagination for large result sets was noted as a known limitation rather than implemented (not in scope).

---

---

### Turn 4 — Failure handling explanation

**User prompt:**
> "How did you handle the failures?"

**Claude's response (summary):**
Explained the three backend layers and one frontend layer:
1. **Per-station partial failure** — `Promise.allSettled` at `departures.js:74`. If one of 17 parallel iRail liveboard calls fails, that station gets an empty `departures: []` plus a `fetchError` string; all other stations still render. Android analogy: `awaitAll()` on a list of `Deferred`, each individually caught.
2. **Total upstream failure** — outer `try/catch` at `departures.js:57`. If the station list call fails completely, returns `502 UPSTREAM_ERROR`.
3. **Axios timeouts** — `irail.js` configures `timeout: 8000` (station list) and `timeout: 6000` (liveboards). Hung connections become rejections that feed into layers 1 and 2.
4. **Frontend network failure** — `App.jsx` `catch` block distinguishes `fetch` throwing (server unreachable) from `res.ok === false` (HTTP error).

---

### Turn 5 — Resilience improvements

**User prompt:**
> "What else can we do to make this resilient?"

**Claude's response (summary):**
Identified four improvements and implemented all of them immediately:

1. **`AbortController` in `App.jsx`** — Correctness bug fix. Without this, a slow response for an old query could arrive after a newer one and overwrite it. The `useEffect` cleanup now calls both `clearTimeout(timer)` and `controller.abort()`, so the in-flight fetch is cancelled whenever the query changes. Android analogy: `job.cancel()` before launching a new coroutine.

2. **Stale station cache fallback in `getStations()`** — If the 10-minute cache refresh fails (iRail transient error), the old station list is served instead of throwing. A `console.warn` is emitted. Only throws if there is no cache at all.

3. **Per-station liveboard cache (30s TTL)** — `getLiveboard()` now checks a `Map` before making an HTTP call. Searching "Bru" twice within 30 seconds goes from 34 iRail calls to 0. Includes a double-check inside the limiter to handle concurrent callers racing to populate the same cache entry.

4. **Concurrency limiter on liveboard calls** — `makeLimiter(5)` is a ~15-line inline semaphore (no new dependency). At most 5 iRail liveboard calls run simultaneously; the rest queue behind them. Android analogy: `Semaphore(5)` from `java.util.concurrent`.

**Files changed:** `frontend/src/App.jsx`, `backend/src/services/irail.js`

---

---

### Turn 6 — Frontend failure handling deep dive

**User prompt:**
> "How do you handle failures on the front end? What is the retry strategy? Any exponential backoff? Maximum retries? Tell me everything. Do not implement anything until I say so."

**Claude's response (summary):**
Gave an honest audit: there was **zero retry logic** in the frontend. One attempt, then the error state showed permanently. Explained the two error paths (network failure vs HTTP error), confirmed no exponential backoff, no max retry count, no distinction between retryable and non-retryable errors, and no user-visible retry affordance. Described what a proper retry strategy would look like before any implementation.

---

### Turn 7 — Retry strategy: timeout-based vs fixed delays

**User prompt:**
> "I have a few ideas."
> *(Selected: Retry strategy for frontend failures)*

**Claude's response (summary):**
Entered plan mode. Designed a full retry strategy plan: custom hook extraction (`useSearchDepartures`), MAX_RETRIES=3, exponential backoff 1s/2s/4s with ±200ms jitter, retryable errors (TypeError + 502/503), cancellation via `AbortController` + `cancelled` flag, and UI feedback showing "Retrying… (attempt N of 4)".

---

### Turn 8 — Timeout base for retry delays

**User prompt:**
> "The retry time should be based on the API timeout or the max timeout of our http call. Retry 1 should be after 1 timeout amount of time, 2nd retry after 2x of timeout, 3rd retry after 3x of timeout. Is that a good idea? What is the timeout on our network client right now?"

**Claude's response (summary):**
Identified that the **frontend `fetch` has no timeout at all** — the backend has 8s (stations) and 6s (liveboards) on axios, but the frontend just waits indefinitely. Explained why timeout-based retry delays are a valid server-to-server pattern but problematic here: (1) they conflate two different failure types — a connection-refused error fails in ~50ms but would still wait 6–10s before retrying; (2) the UX numbers become brutal (10s → 20s → 30s = up to 70s total). Recommended decoupling: add a 10s frontend timeout (so hung requests don't freeze the UI) but keep short fixed backoff (1s → 2s → 4s) since retry delay is about UX recovery, not server breathing room. User agreed.

---

### Turn 9 — Retry strategy implementation

**User prompt:**
> "Makes sense. Add a timeout on frontend also, and implement the retry strategy as we decided. Update AI usage document also with everything."

**Claude's response (summary):**
Implemented the full retry strategy plus the frontend timeout. Key technical details:

**New file: `frontend/src/hooks/useSearchDepartures.js`**
- Custom hook returning `{ results, isLoading, error, retryCount }`
- `FETCH_TIMEOUT_MS = 10_000` — per-attempt timeout using `AbortSignal.timeout()`
- `AbortSignal.any([controller.signal, timeoutSignal])` — combines query-cancel and per-attempt timeout signals without mutating the shared controller (each retry gets a fresh timeout while sharing one query-cancel controller)
- Timeout vs query-change disambiguated by `timeoutSignal.aborted` — no boolean flag needed
- `attempt` is a closure `let`, NOT React state (would re-trigger the effect)
- `cancelled` flag guards all `setState` calls after any `await`
- `retryTimerRef` (useRef) holds the retry setTimeout ID so cleanup can cancel a pending retry
- Retryable: `TypeError`, `AbortError` where `timeoutSignal.aborted === true`, HTTP 502/503
- Not retryable: query-change `AbortError`, HTTP 400/404/500
- Cleanup: sets `cancelled=true`, clears debounce + retry timers, aborts controller, resets `isLoading` and `retryCount`

**Modified: `frontend/src/App.jsx`**
- Removed 3x useState + entire useEffect (~40 lines)
- Replaced with `const { results, isLoading, error, retryCount } = useSearchDepartures(query)`
- `query` stays in App state (owned by App, set by SearchBar)
- Added `retryCount` prop to DepartureList

**Modified: `frontend/src/components/DepartureList.jsx`**
- Imports `TOTAL_ATTEMPTS` from hook file (avoids magic number)
- Loading state shows "Retrying… (attempt N of 4)" when `retryCount > 0`

**Files changed:** `frontend/src/hooks/useSearchDepartures.js` (new), `frontend/src/App.jsx`, `frontend/src/components/DepartureList.jsx`

---

## Implementation Prompts / Approach

No pre-written prompt templates were used. Claude Code operated from the live conversation context, reading the PDF directly, asking clarifying questions, planning, then implementing file-by-file. All architectural decisions (caching strategy, `Promise.allSettled` vs `Promise.all`, filtering on scheduled vs actual time, retry policy, timeout approach) were explained to the user using Android analogies before being implemented.
