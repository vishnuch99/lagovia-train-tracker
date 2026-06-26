const axios = require('axios');
const Fuse = require('fuse.js');

const STATIONS_CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes — station list changes rarely
const LIVEBOARD_TTL_MS = 15 * 1000;             // 15 seconds — fresh enough for a live board
const MAX_CONCURRENT_LIVEBOARDS = 5;

// Shared axios instance so the User-Agent is set once for every iRail call.
// iRail docs: without a user-agent they will block the IP silently on rate limit
// instead of contacting the developer first.
const irailClient = axios.create({
  baseURL: 'https://api.irail.be',
  headers: {
    'User-Agent': 'vishnu_dps/1.0 (chvishnu619@gmail.com)',
  },
});

let stationsCache = null;
let stationsCachedAt = 0;
let stationsEtag = null; // stored ETag for conditional GET on subsequent refreshes

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
 * Fetches the full list of Belgian stations from iRail, with two layers of caching:
 *
 * 1. In-memory TTL (10 min) — skips the network entirely on cache hit.
 * 2. Conditional GET (ETag / If-None-Match) — on TTL expiry, sends the stored ETag
 *    so iRail can return 304 Not Modified when nothing changed, saving all bandwidth.
 *    A 304 refreshes the TTL timestamp but keeps the existing cached data.
 *
 * Falls back to stale cache data if the refresh request fails entirely.
 */
async function getStations() {
  const now = Date.now();
  if (stationsCache && now - stationsCachedAt < STATIONS_CACHE_TTL_MS) {
    return stationsCache;
  }

  const conditionalHeaders = stationsEtag ? { 'If-None-Match': stationsEtag } : {};

  try {
    const response = await irailClient.get('/stations/', {
      params: { format: 'json', lang: 'en' },
      headers: conditionalHeaders,
      timeout: 8000,
      // axios throws on any non-2xx by default — tell it 304 is also acceptable.
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });

    if (response.status === 304) {
      // iRail confirms nothing changed — refresh the TTL so we don't retry for
      // another 10 minutes, but keep the data we already have.
      stationsCachedAt = Date.now();
      return stationsCache;
    }

    stationsCache = response.data.station;
    stationsCachedAt = Date.now();
    if (response.headers.etag) {
      stationsEtag = response.headers.etag;
    }
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
 * Returns stations matching the query.
 *
 * Substring match runs first. If it finds anything, it's returned immediately —
 * no fuzzy pass needed. Fuzzy (fuse.js) only runs as a fallback when substring
 * returns zero results, catching typos like "Antverpen" → "Antwerpen-Centraal".
 *
 * Keeping them separate avoids scoring all 714 stations on every normal query
 * and prevents fuzzy results from appearing alongside exact substring matches.
 */
function searchStations(stations, query) {
  const lowerQuery = query.toLowerCase();

  const substringMatches = stations.filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      (s.standardname && s.standardname.toLowerCase().includes(lowerQuery))
  );

  if (substringMatches.length > 0) return substringMatches;

  // No substring matches — run fuzzy as a typo-tolerance fallback only
  const fuse = new Fuse(stations, {
    keys: ['name', 'standardname'],
    threshold: 0.35,
    distance: 100,
    minMatchCharLength: 3,
  });
  return fuse.search(query).map((r) => r.item);
}

/**
 * Fetches the live departure board for a single station, with a 15-second cache.
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

    const response = await irailClient.get('/liveboard/', {
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
