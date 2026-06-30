import { Search, X, Loader2 } from 'lucide-react';

export default function SearchBar({ value, onChange, onClear, isLoading }) {
  return (
    <div className="mb-6">
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
    </div>
  );
}
