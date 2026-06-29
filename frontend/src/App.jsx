import { useState, useEffect } from 'react';
import { TrainFront } from 'lucide-react';
import SearchBar from './components/SearchBar.jsx';
import DepartureList from './components/DepartureList.jsx';
import { useSearchDepartures } from './hooks/useSearchDepartures.js';

export default function App() {
  const [inputValue, setInputValue] = useState('');
  const [submission, setSubmission] = useState(null);
  const [showRefresh, setShowRefresh] = useState(false);

  const { results, isLoading, error } = useSearchDepartures(submission);

  // Show a Refresh button 15s after results arrive. Resets whenever loading
  // starts (new query or refresh) or results are cleared.
  useEffect(() => {
    if (!results || isLoading) {
      setShowRefresh(false);
      return;
    }
    const timer = setTimeout(() => setShowRefresh(true), 15_000);
    return () => clearTimeout(timer);
  }, [results, isLoading]);

  function handleSubmit() {
    setSubmission({ query: inputValue, id: Date.now() });
  }

  function handleClear() {
    setInputValue('');
    setSubmission(null);
  }

  function handleRefresh() {
    setShowRefresh(false);
    setSubmission((prev) => ({ query: prev.query, id: Date.now() }));
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
          showRefresh={showRefresh}
          onRefresh={handleRefresh}
        />
      </main>
    </div>
  );
}
