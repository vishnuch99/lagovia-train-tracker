import { AlertCircle, MapPin, Clock } from 'lucide-react';

/**
 * DelayBadge — small colored pill showing on-time / delayed / cancelled status.
 * Android analogy: a TextView with a drawable background set programmatically
 * based on the delay value.
 */
function DelayBadge({ delayMinutes, cancelled }) {
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
        On time
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
      +{delayMinutes} min
    </span>
  );
}

/**
 * StationCard — one card per station showing its upcoming departures in a table.
 * Android analogy: a RecyclerView section header followed by its items.
 */
function StationCard({ station }) {
  const hasPlatform = station.departures.some((d) => d.platform);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden">
      {/* Station header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 flex items-center gap-2">
        <MapPin size={15} className="text-slate-500 shrink-0" />
        <h2 className="font-semibold text-slate-800">{station.stationName}</h2>
        <span className="ml-auto text-xs text-slate-500 shrink-0">
          {station.departures.length} departure{station.departures.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Fetch error for this specific station */}
      {station.fetchError && (
        <div className="px-4 py-3 text-sm text-red-600 flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          {station.fetchError}
        </div>
      )}

      {/* Departures table */}
      {station.departures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-50">
                <th className="px-4 py-2">Train</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Scheduled</th>
                <th className="px-4 py-2">Status</th>
                {hasPlatform && <th className="px-4 py-2">Platform</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {station.departures.map((dep) => (
                <tr
                  key={`${dep.trainNumber}-${dep.scheduledTimestamp}`}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600 whitespace-nowrap">
                    {dep.trainNumber}
                  </td>
                  <td
                    className={`px-4 py-3 text-gray-700 ${dep.cancelled ? 'line-through text-gray-400' : ''}`}
                  >
                    {dep.destination}
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                    {dep.scheduledTime}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DelayBadge
                      delayMinutes={dep.delayMinutes}
                      cancelled={dep.cancelled}
                    />
                  </td>
                  {hasPlatform && (
                    <td className="px-4 py-3 text-gray-500">{dep.platform ?? '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * DepartureList — renders the full results area below the search bar.
 * Handles all four states: idle, loading, error, and results (including empty results).
 * Android analogy: a Fragment that observes ViewModel state and switches between
 * different layouts (shimmer, error view, empty view, RecyclerView).
 */
export default function DepartureList({ results, error, query, isLoading }) {
  if (isLoading) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3 animate-pulse">🚂</div>
        <p className="text-sm">Fetching departures…</p>
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
        <p className="text-sm mt-1 text-gray-400">Try "Bru", "Gent", "Ant", or "Liège"</p>
      </div>
    );
  }

  if (results.stations.length === 0) {
    const noStations = results.totalStationsMatched === 0;
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">🚉</div>
        <p className="font-medium text-gray-600">
          {noStations
            ? `No stations found matching "${results.query}"`
            : 'No departures in the next 15 minutes'}
        </p>
        <p className="text-sm mt-1 text-gray-400">
          {noStations
            ? 'Try a different search term or check the spelling'
            : `${results.totalStationsMatched} station${results.totalStationsMatched !== 1 ? 's' : ''} matched, but none have upcoming departures`}
        </p>
      </div>
    );
  }

  const totalDepartures = results.stations.reduce(
    (sum, s) => sum + s.departures.length,
    0
  );

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Clock size={14} />
        <span>
          <strong className="text-gray-700">{totalDepartures}</strong> departure
          {totalDepartures !== 1 ? 's' : ''} across{' '}
          <strong className="text-gray-700">{results.stations.length}</strong> station
          {results.stations.length !== 1 ? 's' : ''} · as of{' '}
          {new Date(results.generatedAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {results.stations.map((station) => (
        <StationCard key={station.stationId} station={station} />
      ))}
    </div>
  );
}
