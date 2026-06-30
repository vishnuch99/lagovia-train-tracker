import { useState } from 'react';
import { AlertCircle, MapPin, Clock, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';

function StatusBadge({ delayMinutes, cancelled }) {
  if (cancelled) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
        Cancelled
      </span>
    );
  }
  if (delayMinutes === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">
        On Time
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
      Delayed
    </span>
  );
}

function StationCard({ station, sortDir, onToggleSort }) {
  const departures = [...station.departures].sort((a, b) =>
    sortDir === 'asc'
      ? a.scheduledTimestamp - b.scheduledTimestamp
      : b.scheduledTimestamp - a.scheduledTimestamp
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4">
      {/* Station header — sticky within the scrollable card list */}
      <div className="sticky top-0 z-10 px-4 py-3 bg-slate-50 border-b border-gray-100 flex items-center gap-2 rounded-t-xl">
        <MapPin size={15} className="text-slate-500 shrink-0" />
        <h2 className="font-semibold text-slate-800">{station.stationName}</h2>
        {!station.fetchError && (
          <span className="ml-auto text-xs text-slate-500 shrink-0">
            {station.departures.length} departure{station.departures.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Fetch error for this station */}
      {station.fetchError && (
        <div className="px-4 py-6 text-center text-sm text-red-700 flex items-center justify-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          {station.fetchError}
        </div>
      )}

      {/* No departures in window */}
      {departures.length === 0 && !station.fetchError && (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          No departures in the next 15 minutes
        </div>
      )}

      {/* Departures table */}
      {departures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-50">
                <th className="px-4 py-2">Train</th>
                <th className="px-4 py-2">Destination</th>
                <th
                  onClick={onToggleSort}
                  className="px-4 py-2 cursor-pointer select-none hover:text-gray-600 transition-colors"
                >
                  <span className="flex items-center gap-1">
                    Scheduled
                    {sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </span>
                </th>
                <th className="px-4 py-2">Delay</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {departures.map((dep) => (
                <tr
                  key={`${dep.trainNumber}-${dep.scheduledTimestamp}`}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600 whitespace-nowrap">
                    {dep.trainNumber}
                  </td>
                  <td className={`px-4 py-3 text-gray-700 ${dep.cancelled ? 'line-through text-gray-400' : ''}`}>
                    {dep.destination}
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                    {dep.scheduledTime}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700 whitespace-nowrap">
                    {dep.delayMinutes === 0 ? '0 min' : `+${dep.delayMinutes} min`}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge delayMinutes={dep.delayMinutes} cancelled={dep.cancelled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DepartureList({ results, error, isLoading, showRefresh, onRefresh }) {
  const [sortDir, setSortDir] = useState('asc');

  function toggleSort() {
    setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
  }

  if (isLoading && !results) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3 animate-pulse">🚂</div>
        <p className="text-sm">Looking up departures…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
        <AlertCircle size={20} className="shrink-0 mt-0.5" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-5xl mb-4">🔍</div>
        <p className="text-lg font-medium text-gray-500">Search for a station</p>
        <p className="text-sm mt-1 text-gray-400">Type at least 3 characters — try "Bru", "Gent", or "Liège"</p>
      </div>
    );
  }

  // No station matched the query at all
  if (results.stations.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">🚉</div>
        <p className="font-medium text-gray-600">
          No stations found for "{results.query}"
        </p>
        <p className="text-sm mt-1 text-gray-400">
          Check the spelling, or try a different search term.
        </p>
      </div>
    );
  }

  const totalDepartures = results.stations.reduce((sum, s) => sum + s.departures.length, 0);

  const sortedStations = [...results.stations].sort((a, b) => {
    const aMin = a.departures.length > 0 ? Math.min(...a.departures.map((d) => d.scheduledTimestamp)) : Infinity;
    const bMin = b.departures.length > 0 ? Math.min(...b.departures.map((d) => d.scheduledTimestamp)) : Infinity;
    return aMin - bMin;
  });

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Clock size={14} />
        <span>
          <strong className="text-gray-700">{totalDepartures}</strong> departure
          {totalDepartures !== 1 ? 's' : ''} across{' '}
          <strong className="text-gray-700">{results.stations.length}</strong> station
          {results.stations.length !== 1 ? 's' : ''} · updated{' '}
          {new Date(results.generatedAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Brussels',
          })}
        </span>
        {showRefresh && (
          <button
            onClick={onRefresh}
            className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-800 transition text-xs font-medium"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        )}
      </div>

      <div>
        {sortedStations.map((station) => (
          <StationCard
            key={station.stationId}
            station={station}
            sortDir={sortDir}
            onToggleSort={toggleSort}
          />
        ))}
      </div>
    </div>
  );
}
