const axios = require('axios');
const Fuse = require('fuse.js');

const IRAIL_BASE = 'https://api.irail.be';
const CACHE_TTL_MS = 10 * 60 * 1000;      // 10 minutes — station list changes rarely
const LIVEBOARD_TTL_MS = 30 * 1000;        // 30 seconds — live data, but don't hammer iRail
const MAX_CONCURRENT_LIVEBOARDS = 5;       // cap parallel iRail calls per incoming request

let stationsCache = null;
let stationsCachedAt = 0;

// Per-station liveboard cache: stationAtId → { data, cachedAt }
const liveboardCache = new Map();

/**
 * Simple concurrency limiter — equivalent to a Semaphore(N) in Java/Kotlin.
 * Keeps at most `max` promises running simultaneously; queues the rest.
 * Written inline to avoid an npm dependency for ~15 lines of code.
 */
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const run = () => {
    if (queue.length === 0 || active >= max) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => { active--; run(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    run();
  });
}

const liveboardLimiter = makeLimiter(MAX_CONCURRENT_LIVEBOARDS);

/**
 * Fetches the full list of Belgian stations from iRail.
 * Results are cached in memory for CACHE_TTL_MS.
 * If the refresh fails but we have stale data, we serve it rather than throwing —
 * a transient iRail blip shouldn't kill all searches.
 */
async function getStations() {
  const now = Date.now();
  if (stationsCache && now - stationsCachedAt < CACHE_TTL_MS) {
    return stationsCache;
  }

  try {
    const response = await axios.get(`${IRAIL_BASE}/stations/`, {
      params: { format: 'json', lang: 'en' },
      timeout: 8000,
    });
    stationsCache = response.data.station;
    stationsCachedAt = Date.now();
    return stationsCache;
  } catch (err) {
    if (stationsCache) {
      // Serve stale data rather than propagating the error upward.
      // The station list changes very rarely, so stale is almost always correct.
      console.warn('[irail] Station refresh failed; serving stale cache:', err.message);
      return stationsCache;
    }
    throw err; // no cache at all — nothing to serve, must fail
  }
}

/**
 * Returns stations matching the query by:
 *   1. Exact substring match on name or standardname (satisfies the core requirement)
 *   2. Fuzzy match via fuse.js for typo tolerance (bonus — e.g. "Antverpen" → "Antwerpen-Centraal")
 * Fuzzy results are appended after substring matches and deduplicated by id.
 */
function searchStations(stations, query) {
  const lowerQuery = query.toLowerCase();

  const substringMatches = stations.filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      (s.standardname && s.standardname.toLowerCase().includes(lowerQuery))
  );
  const substringIds = new Set(substringMatches.map((s) => s.id));

  const fuse = new Fuse(stations, {
    keys: ['name', 'standardname'],
    threshold: 0.35,
    distance: 100,
    minMatchCharLength: 3,
  });
  const fuzzyOnly = fuse
    .search(query)
    .map((r) => r.item)
    .filter((s) => !substringIds.has(s.id));

  return [...substringMatches, ...fuzzyOnly];
}

/**
 * Fetches the live departure board for a single station, with a 30-second cache.
 * Repeated searches for the same station within the window skip the iRail call entirely.
 * The limiter ensures at most MAX_CONCURRENT_LIVEBOARDS calls run in parallel.
 */
async function getLiveboard(stationAtId) {
  const now = Date.now();
  const cached = liveboardCache.get(stationAtId);
  if (cached && now - cached.cachedAt < LIVEBOARD_TTL_MS) {
    return cached.data;
  }

  return liveboardLimiter(async () => {
    // Re-check cache inside the limiter — another concurrent call for the same
    // station may have populated it while this one was queued.
    const rechecked = liveboardCache.get(stationAtId);
    if (rechecked && Date.now() - rechecked.cachedAt < LIVEBOARD_TTL_MS) {
      return rechecked.data;
    }

    const response = await axios.get(`${IRAIL_BASE}/liveboard/`, {
      params: { id: stationAtId, format: 'json', lang: 'en', alerts: 'true' },
      timeout: 6000,
    });
    liveboardCache.set(stationAtId, { data: response.data, cachedAt: Date.now() });
    return response.data;
  });
}

/**
 * Keeps only departures scheduled within the next 15 minutes that haven't left yet.
 * Filters on scheduled time (not actual = scheduled + delay) as the spec requires.
 * dep.left === '0' means the train is still at the platform.
 */
function filterDepartures(departures) {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowEnd = nowSec + 15 * 60;
  return departures.filter((dep) => {
    const scheduled = parseInt(dep.time, 10);
    return scheduled >= nowSec && scheduled <= windowEnd && dep.left === '0';
  });
}

/**
 * Converts a raw iRail departure object into the clean shape our API returns.
 */
function formatDeparture(dep) {
  const scheduledTimestamp = parseInt(dep.time, 10);
  const delaySeconds = parseInt(dep.delay, 10) || 0;

  // vehicle = "BE.NMBS.IC3033" — the train number is the last segment
  const trainNumber = dep.vehicle.split('.').pop();

  const scheduledTime = new Date(scheduledTimestamp * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  });

  return {
    trainNumber,
    destination: dep.station,
    scheduledTime,
    scheduledTimestamp,
    delayMinutes: Math.round(delaySeconds / 60),
    cancelled: dep.canceled === '1',
    platform: dep.platform || null,
  };
}

module.exports = { getStations, searchStations, getLiveboard, filterDepartures, formatDeparture };
