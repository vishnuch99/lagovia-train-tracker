import { useState, useEffect, useRef } from 'react';

const FRIENDLY_ERRORS = {
  QUERY_TOO_SHORT: 'Enter at least 3 characters to search.',
  QUERY_TOO_LONG: 'Search term is too long — try a shorter station name.',
  UPSTREAM_ERROR: 'The Belgian railway service is unreachable right now. Please try again in a moment.',
};

export const MAX_RETRIES = 3;
export const TOTAL_ATTEMPTS = MAX_RETRIES + 1;

const BASE_DELAY_MS = 1000;   // retry 1: ~1s, retry 2: ~2s, retry 3: ~4s
const JITTER_MS = 200;        // ±200ms to prevent retry lockstep
const CONNECT_TIMEOUT_MS = 10_000;

function backoffDelay(attemptIndex) {
  const base = BASE_DELAY_MS * Math.pow(2, attemptIndex);
  const jitter = Math.random() * JITTER_MS * 2 - JITTER_MS;
  return Math.round(base + jitter);
}

/**
 * useSearchDepartures — streams departure results via fetch-based SSE.
 *
 * Why fetch instead of EventSource: EventSource gives no access to the HTTP
 * status code or response body on error (onerror fires with no detail).
 * Using fetch lets us read the 400 "Input is incomplete" response body and
 * display it directly, which is required by the spec.
 *
 * @param {{ query: string, id: number } | null} submission
 *   null  = idle (no search yet, or cleared)
 *   object = an explicit submit; `id` ensures re-submitting the same query
 *            still triggers a fresh effect run.
 *
 * @returns {{ results, isLoading, isStreaming, error, retryCount }}
 *
 * Retry policy (before any data arrives):
 *   Retryable:     network failure, connect timeout
 *   Not retryable: HTTP 4xx (bad input), HTTP 5xx (server bug)
 *   Max retries:   MAX_RETRIES (3), i.e. 4 total attempts
 *   Backoff:       1s → 2s → 4s with ±200ms jitter
 *
 * Mid-stream drop (after stations start arriving): stop gracefully rather
 * than restarting, since partial results are already visible.
 */
export function useSearchDepartures(submission) {
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const metaRef = useRef(null);
  const stationsRef = useRef([]);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (submission === null) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      setIsStreaming(false);
      setRetryCount(0);
      return;
    }

    const { query } = submission;

    setIsLoading(true);
    setIsStreaming(true);
    setError(null);
    setResults(null);
    setRetryCount(0);
    metaRef.current = null;
    stationsRef.current = [];

    let cancelled = false;
    let attempt = 0;
    const queryController = new AbortController();

    async function connect() {
      const url = `/departures?q=${encodeURIComponent(query)}`;

      // Connect timeout: applies only to getting the first response headers.
      // Once response.ok is confirmed we clear it so the stream reads indefinitely.
      // Using manual setTimeout+AbortController instead of AbortSignal.timeout() because
      // AbortSignal.timeout() stays active and kills reader.read() mid-stream after 10s.
      const connectTimeoutController = new AbortController();
      const connectTimeoutId = setTimeout(
        () => connectTimeoutController.abort(),
        CONNECT_TIMEOUT_MS
      );
      const signal = AbortSignal.any([queryController.signal, connectTimeoutController.signal]);

      let response;
      try {
        response = await fetch(url, { signal });
      } catch (err) {
        clearTimeout(connectTimeoutId);
        if (queryController.signal.aborted) return; // query changed — stop
        scheduleRetry(); // network error or connect timeout — worth retrying
        return;
      }

      // Headers received — stop the connect timer so it doesn't kill body reads.
      clearTimeout(connectTimeoutId);

      if (!response.ok) {
        // HTTP error — read the JSON body to surface the backend's message.
        // 400 = "Input is incomplete" (spec requirement).
        // Do not retry: the request was understood; the input is the problem.
        const body = await response.json().catch(() => ({}));
        if (!cancelled) {
          setError(FRIENDLY_ERRORS[body.code] || 'Something went wrong. Please try again.');
          setIsLoading(false);
          setIsStreaming(false);
        }
        return;
      }

      // 200 OK — parse the SSE stream manually chunk by chunk.
      // SSE format: "data: <json>\n\n" per event.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) {
            if (cancelled) reader.cancel();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop(); // hold the last (possibly incomplete) chunk

          for (const chunk of chunks) {
            const line = chunk.trim();
            if (line.startsWith('data: ')) {
              handleEvent(JSON.parse(line.slice(6)));
            }
          }
        }
      } catch {
        if (cancelled) return;
        // Stream dropped mid-way — if stations are already visible, stop gracefully
        if (stationsRef.current.length > 0) {
          setIsStreaming(false);
          return;
        }
        scheduleRetry();
        return; // stay in loading/streaming while retry is pending
      }

      // Stream ended cleanly (done=true) without a SSE 'done' event.
      // This covers mid-stream drops that close the connection without error.
      if (!cancelled) {
        setIsStreaming(false);
        setIsLoading(false);
      }
    }

    function handleEvent(data) {
      if (cancelled) return;

      if (data.type === 'meta') {
        metaRef.current = {
          query: data.query,
          generatedAt: data.generatedAt,
          totalStationsMatched: data.totalStationsMatched,
        };
        stationsRef.current = [];
        attempt = 0;      // successfully connected — reset retry counter
        setRetryCount(0);

      } else if (data.type === 'station') {
        // Sort departures within the card by scheduled time.
        const sortedDepartures = [...(data.departures ?? [])].sort(
          (a, b) => a.scheduledTimestamp - b.scheduledTimestamp
        );

        const updated = [
          ...stationsRef.current,
          {
            stationId: data.stationId,
            stationName: data.stationName,
            departures: sortedDepartures,
            fetchError: data.fetchError,
          },
        ];

        // Sort cards: earliest departure first; empty/error stations (Infinity) sink to bottom.
        updated.sort((a, b) => {
          const aMin = a.departures.length > 0
            ? Math.min(...a.departures.map((d) => d.scheduledTimestamp))
            : Infinity;
          const bMin = b.departures.length > 0
            ? Math.min(...b.departures.map((d) => d.scheduledTimestamp))
            : Infinity;
          return aMin - bMin;
        });

        stationsRef.current = updated;
        setIsLoading(false); // first station: drop full-page spinner
        setResults({ ...metaRef.current, stations: stationsRef.current });

      } else if (data.type === 'done') {
        setIsStreaming(false);
        setIsLoading(false);
        // Edge case: query matched zero stations (totalStationsMatched === 0)
        if (metaRef.current && stationsRef.current.length === 0) {
          setResults({ ...metaRef.current, stations: [] });
        }

      } else if (data.type === 'error') {
        setError(FRIENDLY_ERRORS[data.code] || data.error);
        setIsLoading(false);
        setIsStreaming(false);
      }
    }

    function scheduleRetry() {
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        setRetryCount(attempt);
        retryTimerRef.current = setTimeout(() => {
          if (!cancelled) connect();
        }, backoffDelay(attempt - 1));
      } else {
        setError('Network error — could not reach the server. Is the backend running?');
        setIsLoading(false);
        setIsStreaming(false);
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimerRef.current);
      queryController.abort();
      setIsLoading(false);
      setIsStreaming(false);
      setRetryCount(0);
    };
  }, [submission]);

  return { results, isLoading, isStreaming, error, retryCount };
}
