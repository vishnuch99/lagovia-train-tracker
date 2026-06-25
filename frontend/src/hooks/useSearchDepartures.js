import { useState, useEffect, useRef } from 'react';

export const MAX_RETRIES = 3;                // 1 initial attempt + 3 retries = 4 total
export const TOTAL_ATTEMPTS = MAX_RETRIES + 1;

const BASE_DELAY_MS = 1000;                  // retry 1: ~1s, retry 2: ~2s, retry 3: ~4s
const JITTER_MS = 200;                       // ±200ms added to each delay
const FETCH_TIMEOUT_MS = 10_000;             // 10s per attempt — matches backend's worst-case axios timeout

/**
 * Determines whether an HTTP status code is worth retrying.
 * 502/503 = upstream (iRail) is down or overloaded — transient.
 * 400/404/500 = structural error — retrying the same request won't help.
 */
function isRetryableStatus(status) {
  return status === 502 || status === 503;
}

/**
 * Exponential backoff with uniform jitter.
 * attemptIndex 0 → ~1000ms, 1 → ~2000ms, 2 → ~4000ms.
 * Jitter prevents multiple clients from retrying in lockstep.
 */
function backoffDelay(attemptIndex) {
  const base = BASE_DELAY_MS * Math.pow(2, attemptIndex);
  const jitter = Math.random() * JITTER_MS * 2 - JITTER_MS;
  return Math.round(base + jitter);
}

/**
 * useSearchDepartures — encapsulates all fetch + retry logic for the search feature.
 *
 * Android analogy: this is a ViewModel use-case that owns the network call lifecycle,
 * including retry logic. App.jsx is the Activity/Fragment that just observes the result.
 *
 * @param {string} query  The current search string (owned by App state).
 * @returns {{ results, isLoading, error, retryCount }}
 *
 * retryCount is 0 on the initial attempt, 1/2/3 during retries — used by
 * DepartureList to show "Retrying… (attempt N of 4)" in the loading state.
 *
 * Retry policy:
 *   - Retryable:     network failure (TypeError), per-attempt timeout, HTTP 502/503
 *   - Not retryable: query-change cancel (AbortError, cancelled=true), HTTP 400/404/500
 *   - Max retries:   MAX_RETRIES (3), so 4 total attempts
 *   - Backoff:       1s → 2s → 4s with ±200ms jitter
 *   - Per-attempt timeout: FETCH_TIMEOUT_MS (10s)
 *
 * Cancellation:
 *   The useEffect cleanup fires whenever `query` changes. It sets `cancelled = true`
 *   (stops any pending setState calls), clears the retry timer, and aborts the
 *   per-query AbortController. This is the equivalent of job.cancel() in Kotlin
 *   coroutines — the entire retry loop for the old query is abandoned cleanly.
 *
 * Timeout vs query-change abort:
 *   Both fire as AbortError. They're disambiguated by checking `timeoutSignal.aborted`:
 *   true = the 10s timeout fired (retryable), false = the query changed (not retryable).
 *   AbortSignal.any() combines both signals without touching the underlying controller,
 *   so each retry gets a fresh timeout while sharing the same query-cancel controller.
 */
export function useSearchDepartures(query) {
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // Holds the retry wait timer so the cleanup function can cancel a pending retry.
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults(null);
      setError(null);
      setRetryCount(0);
      return;
    }

    // One controller per query. Aborted by cleanup when query changes.
    // NOT aborted by per-attempt timeouts — those use a separate signal.
    const controller = new AbortController();

    // Local to this effect invocation — NOT React state (would re-trigger the effect).
    let attempt = 0;

    // Set to true by cleanup — guards all setState calls after any await.
    let cancelled = false;

    async function attemptFetch() {
      setIsLoading(true);
      setError(null);

      // Per-attempt timeout signal. A fresh one is created for every attempt so
      // each retry gets its own 10s window. AbortSignal.any() merges it with the
      // query-cancel signal without mutating the underlying controller.
      const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const signal = AbortSignal.any([controller.signal, timeoutSignal]);

      try {
        const res = await fetch(`/departures?q=${encodeURIComponent(query.trim())}`, {
          signal,
        });

        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setResults(data);
            setIsLoading(false);
            setRetryCount(0);
          }
          return;
        }

        // Retryable HTTP error (502/503) with attempts remaining
        if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
          scheduleRetry();
          return;
        }

        // Non-retryable HTTP error — show the error message from the backend
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setError(body.error || `Server error (${res.status})`);
          setResults(null);
          setIsLoading(false);
        }

      } catch (err) {
        if (err.name === 'AbortError') {
          if (!cancelled && timeoutSignal.aborted && attempt < MAX_RETRIES) {
            // Per-attempt timeout fired (not a query-change cancel) — worth retrying
            scheduleRetry();
            return;
          }
          // Either the query changed (cancelled=true), or timeout with no retries left
          if (!cancelled) {
            if (timeoutSignal.aborted) {
              setError('Request timed out — the server took too long to respond.');
              setResults(null);
            }
            setIsLoading(false);
          }
          return;
        }

        // Network failure (TypeError: fetch failed, DNS error, connection refused)
        if (err instanceof TypeError && attempt < MAX_RETRIES) {
          scheduleRetry();
          return;
        }

        if (!cancelled) {
          setError('Network error — could not reach the server. Is the backend running?');
          setResults(null);
          setIsLoading(false);
        }
      }
    }

    function scheduleRetry() {
      attempt += 1;
      setRetryCount(attempt); // drives "Retrying… (attempt N of 4)" in the UI
      retryTimerRef.current = setTimeout(() => {
        if (!cancelled) attemptFetch();
      }, backoffDelay(attempt - 1));
      // attempt-1 because attempt just incremented:
      // after 1st failure attempt=1, delay index=0 → ~1000ms
      // after 2nd failure attempt=2, delay index=1 → ~2000ms
      // after 3rd failure attempt=3, delay index=2 → ~4000ms
    }

    // Debounce the initial attempt — same 350ms as before
    const debounceTimer = setTimeout(() => {
      if (!cancelled) attemptFetch();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      clearTimeout(retryTimerRef.current);
      controller.abort();        // cancels any in-flight fetch for this query
      setIsLoading(false);       // clears spinner if query changes mid-retry
      setRetryCount(0);          // clears "Retrying…" message for the new query
    };
  }, [query]);

  return { results, isLoading, error, retryCount };
}
