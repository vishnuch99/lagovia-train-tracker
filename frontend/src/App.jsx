import { useState } from 'react';
import { TrainFront } from 'lucide-react';
import SearchBar from './components/SearchBar.jsx';
import DepartureList from './components/DepartureList.jsx';
import { useSearchDepartures } from './hooks/useSearchDepartures.js';

/**
 * App is the root component — think of it as your MainActivity.
 * It owns `query` (driven by SearchBar) and passes the derived fetch state
 * from useSearchDepartures down to DepartureList as props.
 *
 * All fetch/retry/timeout logic lives in useSearchDepartures — keeping this
 * component as a pure layout-and-wiring layer.
 */
export default function App() {
  const [query, setQuery] = useState('');
  const { results, isLoading, error, retryCount } = useSearchDepartures(query);

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
          retryCount={retryCount}
        />
      </main>
    </div>
  );
}
