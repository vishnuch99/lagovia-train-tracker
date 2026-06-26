import { Search, X, Loader2 } from 'lucide-react';

/**
 * SearchBar — a submit-triggered search form.
 *
 * The search fires only on explicit submission (button click or Enter key),
 * never as-you-type. This lets the backend validate the query length and return
 * the appropriate error response, satisfying constraint #1 in the spec.
 *
 * Android analogy: an EditText + Button pair where the Button's onClick
 * fires the search Intent — not a TextWatcher triggering on every keystroke.
 */
export default function SearchBar({ value, onChange, onSubmit, onClear, isLoading }) {
  function handleSubmit(e) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Search size={18} />
            )}
          </div>

          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='Search stations… e.g. "Bru", "Gent", "Ant", "Liège"'
            className="w-full pl-10 pr-10 py-3 text-base border border-gray-300 rounded-xl shadow-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       bg-white transition"
            autoFocus
          />

          {value && (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl
                     hover:bg-blue-700 active:bg-blue-800 transition
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Search
        </button>
      </form>
    </div>
  );
}
