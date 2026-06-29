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
 * Finds matching stations, fetches all liveboards concurrently, returns one JSON.
 *
 * Response shape:
 *   200 { query, generatedAt, stations: [{ stationId, stationName, departures[], fetchError? }] }
 *   400 { error, code: 'QUERY_TOO_SHORT' }
 *   502 { error, code: 'UPSTREAM_ERROR' }
 */
router.get('/', async (req, res) => {
  const query = (req.query.q || '').trim();

  if (query.length < 3) {
    return res.status(400).json({
      error: 'Input is incomplete',
      code: 'QUERY_TOO_SHORT',
    });
  }

  try {
    const allStations = await getStations();
    const matchingStations = searchStations(allStations, query);

    const stations = await Promise.all(
      matchingStations.map(async (station) => {
        try {
          const liveboard = await getLiveboard(station['@id']);
          const raw = liveboard.departures?.departure ?? [];
          const arr = Array.isArray(raw) ? raw : [raw];
          const filtered = filterDepartures(arr.filter((d) => d && d.time));
          return {
            stationId: station.id,
            stationName: station.displayName,
            departures: filtered.map(formatDeparture),
          };
        } catch {
          return {
            stationId: station.id,
            stationName: station.displayName,
            departures: [],
            fetchError: 'Could not load departures for this station',
          };
        }
      })
    );

    res.json({ query, generatedAt: new Date().toISOString(), stations });

  } catch (err) {
    console.error('[/departures] Unexpected error:', err.message);
    res.status(502).json({ error: 'Failed to reach the iRail upstream API', code: 'UPSTREAM_ERROR' });
  }
});

module.exports = router;
