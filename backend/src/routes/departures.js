const express = require('express');
const {
  getStations,
  searchStations,
  getLiveboard,
  filterDepartures,
  formatDeparture,
} = require('../services/irail');

const router = express.Router();

/**
 * GET /departures?q=<query>
 *
 * Returns upcoming departures (next 15 minutes) from every station whose
 * name contains the query substring, with fuzzy fallback for typos.
 *
 * Response shape:
 * {
 *   query: string,
 *   generatedAt: ISO8601 string,
 *   totalStationsMatched: number,   // stations found before departure filtering
 *   stations: [
 *     {
 *       stationId: string,
 *       stationName: string,
 *       departures: [
 *         {
 *           trainNumber: string,       // e.g. "IC3033"
 *           destination: string,
 *           scheduledTime: string,     // "HH:MM" in Europe/Brussels
 *           scheduledTimestamp: number,// Unix seconds
 *           delayMinutes: number,      // 0 = on time
 *           cancelled: boolean,
 *           platform: string | null
 *         }
 *       ],
 *       fetchError?: string   // present only when iRail call failed for this station
 *     }
 *   ]
 * }
 *
 * Error responses:
 *   400 { error, code: "QUERY_TOO_SHORT" }
 *   502 { error, code: "UPSTREAM_ERROR" }
 */
router.get('/', async (req, res) => {
  const query = (req.query.q || '').trim();

  if (query.length < 3) {
    return res.status(400).json({
      error: 'Query must be at least 3 characters',
      code: 'QUERY_TOO_SHORT',
    });
  }

  try {
    const allStations = await getStations();
    const matchingStations = searchStations(allStations, query);

    if (matchingStations.length === 0) {
      return res.json({
        query,
        generatedAt: new Date().toISOString(),
        totalStationsMatched: 0,
        stations: [],
      });
    }

    // Fetch all liveboards concurrently.
    // Promise.allSettled (vs Promise.all) means one failing station doesn't
    // cancel the others — equivalent to launching parallel coroutines and
    // collecting results even when some throw.
    const settled = await Promise.allSettled(
      matchingStations.map((s) => getLiveboard(s['@id']))
    );

    const stations = settled.map((result, i) => {
      const station = matchingStations[i];

      if (result.status === 'rejected') {
        return {
          stationId: station.id,
          stationName: station.name,
          departures: [],
          fetchError: 'Could not load departures for this station',
        };
      }

      const rawDepartures = result.value.departures?.departure ?? [];
      const departureArray = Array.isArray(rawDepartures) ? rawDepartures : [rawDepartures];
      const valid = departureArray.filter((d) => d && d.time);
      const filtered = filterDepartures(valid);

      return {
        stationId: station.id,
        stationName: station.name,
        departures: filtered.map(formatDeparture),
      };
    });

    // Only surface stations that have something to show: upcoming departures
    // or a fetch error (so the UI can warn the user something went wrong).
    const relevant = stations.filter((s) => s.departures.length > 0 || s.fetchError);

    res.json({
      query,
      generatedAt: new Date().toISOString(),
      totalStationsMatched: matchingStations.length,
      stations: relevant,
    });
  } catch (err) {
    console.error('[/departures] Unexpected error:', err.message);
    res.status(502).json({
      error: 'Failed to reach the iRail upstream API',
      code: 'UPSTREAM_ERROR',
    });
  }
});

module.exports = router;
