import { Search, X, Loader2 } from 'lucide-react';

/**
 * SearchBar — a controlled input component.
 * Android analogy: a custom EditText with an attached TextWatcher.
 * "Controlled" means React owns the value (query prop), not the DOM —
 * like binding an EditText to a StateFlow in two-way mode.
 *
 * Props:
 *   query     — current text value (from App state)
 *   onChange  — callback to update App state (like emitting to a StateFlow)
 *   isLoading — shows a spinner instead of the search icon while fetching
 */
export default function SearchBar({ query, onChange, isLoading }) {
  const charsLeft = 3 - query.length;

  return (
    <div className="mb-6">
      <div className="relative flex items-center">
        <div className="absolute left-3 text-gray-400 pointer-events-none">
          {isLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Search size={18} />
          )}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder='Search stations… e.g. "Bru", "Gent", "Ant", "Liège"'
          className="w-full pl-10 pr-10 py-3 text-base border border-gray-300 rounded-xl shadow-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     bg-white transition"
          autoFocus
        />

        {query && (
          <button
            onClick={() => onChange('')}
            className="absolute right-3 text-gray-400 hover:text-gray-600 transition"
            aria-label="Clear search"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {query.length > 0 && query.length < 3 && (
        <p className="mt-2 text-sm text-amber-600">
          Type {charsLeft} more character{charsLeft !== 1 ? 's' : ''} to search
        </p>
      )}
    </div>
  );
}
