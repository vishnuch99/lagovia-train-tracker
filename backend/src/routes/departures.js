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
 * Streams results as Server-Sent Events (SSE) so the frontend can render
 * stations as their liveboards resolve, rather than waiting for all of them.
 *
 * Event sequence:
 *   { type: 'meta',    query, generatedAt, totalStationsMatched }
 *   { type: 'station', stationId, stationName, departures[], fetchError? }  ← N of these
 *   { type: 'done' }
 *
 * On hard failure (station list unreachable):
 *   { type: 'error', error, code }
 *
 * Error before SSE headers (invalid input):
 *   400 { error, code: 'QUERY_TOO_SHORT' }
 */
router.get('/', async (req, res) => {
  const query = (req.query.q || '').trim();

  if (query.length < 3) {
    return res.status(400).json({
      error: 'Query must be at least 3 characters',
      code: 'QUERY_TOO_SHORT',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Guard writes after the client navigates away or changes query
  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (data) => {
    if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const allStations = await getStations();
    const matchingStations = searchStations(allStations, query);

    send({
      type: 'meta',
      query,
      generatedAt: new Date().toISOString(),
      totalStationsMatched: matchingStations.length,
    });

    if (matchingStations.length === 0) {
      send({ type: 'done' });
      return res.end();
    }

    // Emit each station the moment its liveboard resolves.
    // getLiveboard goes through the shared rate limiter — burst stations arrive
    // first (~5 immediately), the rest at ~2/s, so the client sees progressive updates.
    await Promise.allSettled(
      matchingStations.map(async (station) => {
        try {
          const liveboard = await getLiveboard(station['@id']);
          const rawDepartures = liveboard.departures?.departure ?? [];
          const departureArray = Array.isArray(rawDepartures) ? rawDepartures : [rawDepartures];
          const valid = departureArray.filter((d) => d && d.time);
          const filtered = filterDepartures(valid);
          send({
            type: 'station',
            stationId: station.id,
            stationName: station.name,
            departures: filtered.map(formatDeparture),
          });
        } catch {
          send({
            type: 'station',
            stationId: station.id,
            stationName: station.name,
            departures: [],
            fetchError: 'Could not load departures for this station',
          });
        }
      })
    );

    send({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('[/departures] Unexpected error:', err.message);
    send({ type: 'error', error: 'Failed to reach the iRail upstream API', code: 'UPSTREAM_ERROR' });
    res.end();
  }
});

module.exports = router;
