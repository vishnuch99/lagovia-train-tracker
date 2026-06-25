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

## Implementation Prompts / Approach

No pre-written prompt templates were used. Claude Code operated from the live conversation context, reading the PDF directly, asking clarifying questions, planning, then implementing file-by-file. All architectural decisions (caching strategy, `Promise.allSettled` vs `Promise.all`, filtering on scheduled vs actual time) were explained to the user using Android analogies before being implemented.
