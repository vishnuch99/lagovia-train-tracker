import { useState, useEffect } from 'react';

export function useSearchDepartures(submission) {
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (submission === null) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const { query } = submission;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setResults(null);

    const FRIENDLY_ERRORS = {
      QUERY_TOO_SHORT: 'Enter at least 3 characters to search.',
      QUERY_TOO_LONG: 'Search term is too long — try a shorter station name.',
      UPSTREAM_ERROR: 'The Belgian railway service is unreachable right now. Please try again in a moment.',
    };

    fetch(`/departures?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((b) =>
            Promise.reject(new Error(FRIENDLY_ERRORS[b.code] || 'Something went wrong. Please try again.'))
          );
        }
        return res.json();
      })
      .then((data) => {
        setResults(data);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        const message = err instanceof TypeError
          ? 'Unable to connect. Please check your connection and try again.'
          : err.message;
        setError(message);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [submission]);

  return { results, isLoading, error };
}
