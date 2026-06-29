const express = require('express');
const irail = require('../services/irail');

const router = express.Router();

const MAX_QUERY_LENGTH = 100;

/**
 * GET /departures?q=<query>
 *
 * Finds matching stations, fetches all liveboards concurrently, returns one JSON.
 *
 * Response shape:
 *   200 { query, generatedAt, stations: [{ stationId, stationName, departures[], fetchError? }] }
 *   400 { error, code: 'QUERY_TOO_SHORT' }
 *   400 { error, code: 'QUERY_TOO_LONG' }
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

  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      error: 'Query is too long',
      code: 'QUERY_TOO_LONG',
    });
  }

  try {
    const allStations = await irail.getStations();
    const matchingStations = irail.searchStations(allStations, query);

    const stations = await Promise.all(
      matchingStations.map(async (station) => {
        try {
          const liveboard = await irail.getLiveboard(station['@id']);
          const raw = liveboard.departures?.departure ?? [];
          const arr = Array.isArray(raw) ? raw : [raw];
          const filtered = irail.filterDepartures(arr.filter((d) => d && d.time));
          return {
            stationId: station.id,
            stationName: station.displayName,
            departures: filtered.map(irail.formatDeparture),
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
