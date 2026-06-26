import { useState, useEffect, useRef } from 'react';

const DEBOUNCE_MS = 350;

/**
 * useSearchDepartures — streams departure results via Server-Sent Events.
 *
 * Android analogy: a Flow<List<StationResult>> — emits partial results as
 * each station's liveboard resolves on the backend instead of waiting for all
 * of them. Cleanup closes the SSE connection, equivalent to job.cancel().
 *
 * @param {string} query The current search string (owned by App state).
 * @returns {{ results, isLoading, isStreaming, error }}
 *
 * isLoading:   true while waiting for the first station (full-page spinner)
 * isStreaming: true while more stations are still arriving (show results + indicator)
 * results:     null until first station, then updates incrementally
 * error:       set on connection failure or upstream error event
 */
export function useSearchDepartures(query) {
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);

  // Refs hold accumulating state that must not trigger re-renders on write
  const metaRef = useRef(null);
  const stationsRef = useRef([]);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      setIsStreaming(false);
      return;
    }

    setIsLoading(true);
    setIsStreaming(true);
    setError(null);
    setResults(null);
    metaRef.current = null;
    stationsRef.current = [];

    let cancelled = false;
    let esCleanup = null; // set once the EventSource is created (after debounce)

    const debounceTimer = setTimeout(() => {
      const url = `/departures?q=${encodeURIComponent(query.trim())}`;
      const es = new EventSource(url);
      esCleanup = () => es.close();

      es.onmessage = (event) => {
        if (cancelled) return;
        const data = JSON.parse(event.data);

        if (data.type === 'meta') {
          metaRef.current = {
            query: data.query,
            generatedAt: data.generatedAt,
            totalStationsMatched: data.totalStationsMatched,
          };
          stationsRef.current = [];

        } else if (data.type === 'station') {
          // Only accumulate stations that have something visible to the user
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
            setIsLoading(false); // drop full-page spinner; partial results are ready
            setResults({ ...metaRef.current, stations: stationsRef.current });
          }

        } else if (data.type === 'done') {
          es.close();
          setIsStreaming(false);
          setIsLoading(false);
          // Edge case: stations were matched but none had departures in the window
          if (metaRef.current && stationsRef.current.length === 0) {
            setResults({ ...metaRef.current, stations: [] });
          }

        } else if (data.type === 'error') {
          es.close();
          setError(data.error);
          setIsLoading(false);
          setIsStreaming(false);
        }
      };

      es.onerror = () => {
        if (!cancelled) {
          es.close();
          setError('Network error — could not reach the server. Is the backend running?');
          setIsLoading(false);
          setIsStreaming(false);
        }
      };
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      if (esCleanup) esCleanup();
      setIsLoading(false);
      setIsStreaming(false);
    };
  }, [query]);

  return { results, isLoading, isStreaming, error };
}
