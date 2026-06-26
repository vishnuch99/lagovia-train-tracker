import { useState } from 'react';
import { TrainFront } from 'lucide-react';
import SearchBar from './components/SearchBar.jsx';
import DepartureList from './components/DepartureList.jsx';
import { useSearchDepartures } from './hooks/useSearchDepartures.js';

/**
 * App is the root component — equivalent to MainActivity.
 *
 * State split:
 *   inputValue   — what's currently typed in the box (live)
 *   submission   — { query, id } set on explicit submit; id=Date.now() ensures
 *                  re-submitting the same query still triggers a fresh search
 *
 * Android analogy: inputValue is the EditText buffer; submission is the intent
 * fired when the user taps Search, carrying the current query as an extra.
 */
export default function App() {
  const [inputValue, setInputValue] = useState('');
  const [submission, setSubmission] = useState(null);

  const { results, isLoading, isStreaming, error, retryCount } = useSearchDepartures(submission);

  function handleSubmit() {
    setSubmission({ query: inputValue, id: Date.now() });
  }

  function handleClear() {
    setInputValue('');
    setSubmission(null);
  }

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
        <SearchBar
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onClear={handleClear}
          isLoading={isLoading}
        />
        <DepartureList
          results={results}
          error={error}
          isLoading={isLoading}
          isStreaming={isStreaming}
          retryCount={retryCount}
        />
      </main>
    </div>
  );
}
