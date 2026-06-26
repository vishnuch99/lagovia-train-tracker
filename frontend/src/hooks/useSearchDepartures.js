import { useState, useEffect, useRef } from 'react';

export const MAX_RETRIES = 3;
export const TOTAL_ATTEMPTS = MAX_RETRIES + 1;

const DEBOUNCE_MS = 350;
const BASE_DELAY_MS = 1000;    // retry 1: ~1s, retry 2: ~2s, retry 3: ~4s
const JITTER_MS = 200;         // ±200ms so multiple clients don't lockstep
const CONNECT_TIMEOUT_MS = 10_000; // if no 'meta' event within 10s, treat as failure

function backoffDelay(attemptIndex) {
  const base = BASE_DELAY_MS * Math.pow(2, attemptIndex);
  const jitter = Math.random() * JITTER_MS * 2 - JITTER_MS;
  return Math.round(base + jitter);
}

/**
 * useSearchDepartures — streams departure results via Server-Sent Events.
 *
 * Android analogy: a Flow<List<StationResult>> with automatic retry — emits
 * partial results as each station's liveboard resolves, retries on connection
 * failure (before any data arrives), and stops gracefully if a mid-stream drop
 * occurs after partial results are already visible.
 *
 * @param {string} query The current search string (owned by App state).
 * @returns {{ results, isLoading, isStreaming, error, retryCount }}
 *
 * isLoading:   true while waiting for the first station (full-page spinner)
 * isStreaming: true while more stations are still arriving
 * retryCount:  0 on first attempt, 1–3 during retries (drives "Retrying…" UI)
 */
export function useSearchDepartures(query) {
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const metaRef = useRef(null);
  const stationsRef = useRef([]);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      setIsStreaming(false);
      setRetryCount(0);
      return;
    }

    setIsLoading(true);
    setIsStreaming(true);
    setError(null);
    setResults(null);
    setRetryCount(0);
    metaRef.current = null;
    stationsRef.current = [];

    let cancelled = false;
    let attempt = 0;
    let esRef = null; // current EventSource, kept so cleanup can close it

    function connect() {
      const url = `/departures?q=${encodeURIComponent(query.trim())}`;
      const es = new EventSource(url);
      esRef = es;

      let receivedMeta = false;

      // If the backend doesn't respond at all within 10s, treat it as a failure.
      // EventSource itself never times out — we have to enforce this manually.
      const connectTimeout = setTimeout(() => {
        if (!receivedMeta && !cancelled) {
          es.close();
          handleFailure();
        }
      }, CONNECT_TIMEOUT_MS);

      es.onmessage = (event) => {
        if (cancelled) return;
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          receivedMeta = true;
          clearTimeout(connectTimeout);
          // Successfully connected — reset retry counter so UI shows clean state
          attempt = 0;
          setRetryCount(0);
          metaRef.current = {
            query: data.query,
            generatedAt: data.generatedAt,
            totalStationsMatched: data.totalStationsMatched,
          };
          stationsRef.current = [];

        } else if (data.type === 'station') {
          if (data.departures.length > 0 || data.fetchError) {
            stationsRef.current = [
              ...stationsRef.current,
              {
                stationId: data.stationId,
                stationName: data.stationName,
                departures: data.departures,
                fetchError: data.fetchError,
              },
            ];
          }
          if (stationsRef.current.length > 0) {
            setIsLoading(false);
            setResults({ ...metaRef.current, stations: stationsRef.current });
          }

        } else if (data.type === 'done') {
          clearTimeout(connectTimeout);
          es.close();
          setIsStreaming(false);
          setIsLoading(false);
          if (metaRef.current && stationsRef.current.length === 0) {
            setResults({ ...metaRef.current, stations: [] });
          }

        } else if (data.type === 'error') {
          clearTimeout(connectTimeout);
          es.close();
          setError(data.error);
          setIsLoading(false);
          setIsStreaming(false);
        }
      };

      es.onerror = () => {
        clearTimeout(connectTimeout);
        if (cancelled) return;
        es.close();

        if (stationsRef.current.length > 0) {
          // Already showing partial results — stop gracefully rather than
          // restarting and potentially showing duplicate or stale stations.
          setIsStreaming(false);
          return;
        }

        handleFailure();
      };
    }

    function handleFailure() {
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

    const debounceTimer = setTimeout(() => {
      if (!cancelled) connect();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      clearTimeout(retryTimerRef.current);
      if (esRef) esRef.close();
      setIsLoading(false);
      setIsStreaming(false);
      setRetryCount(0);
    };
  }, [query]);

  return { results, isLoading, isStreaming, error, retryCount };
}
