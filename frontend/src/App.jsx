import { useState, useEffect } from 'react';
import { TrainFront } from 'lucide-react';
import SearchBar from './components/SearchBar.jsx';
import DepartureList from './components/DepartureList.jsx';

/**
 * App is the root component — think of it as your MainActivity combined with a ViewModel.
 * All shared state lives here and is passed down to child components as props.
 *
 * State:
 *   query      — the text the user has typed
 *   results    — the parsed JSON from the backend (null until first successful fetch)
 *   isLoading  — true while the fetch is in-flight (drives the spinner)
 *   error      — an error string if something went wrong (null otherwise)
 */
export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * useEffect with [query] dependency = runs every time query changes.
   * Android analogy: this is a TextWatcher with debounce(350ms) feeding into
   * a CoroutineScope.launch block. The cleanup function (return () => ...) cancels
   * the previous timer if the user types again before it fires — exactly like
   * cancelling a previous coroutine Job before launching a new one.
   */
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults(null);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/departures?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Something went wrong');
          setResults(null);
        } else {
          setResults(data);
        }
      } catch {
        setError('Network error — could not reach the server. Is the backend running?');
        setResults(null);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white py-8 px-4 shadow-md">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <TrainFront size={28} className="text-blue-400" />
            <h1 className="text-2xl font-bold tracking-tight">Lagovia Train Tracker</h1>
          </div>
          <p className="text-slate-400 text-sm ml-10">
            Live departures · Next 15 minutes · Powered by iRail
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <SearchBar query={query} onChange={setQuery} isLoading={isLoading} />
        <DepartureList
          results={results}
          error={error}
          query={query}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}
