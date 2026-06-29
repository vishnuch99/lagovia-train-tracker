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

    fetch(`/departures?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((b) =>
            Promise.reject(new Error(b.error || `Server error (${res.status})`))
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
        setError(err.message);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [submission]);

  return { results, isLoading, error };
}
