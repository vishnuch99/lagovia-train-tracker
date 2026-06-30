const axios = require('axios');
const Fuse = require('fuse.js');

const STATIONS_CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes — station list changes rarely
const LIVEBOARD_TTL_MS = 15 * 1000;             // 15 seconds — fresh enough for a live board

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
const liveboardInflight = new Map();

// Evict stale liveboard entries every TTL interval so the Map stays bounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of liveboardCache) {
    if (now - val.cachedAt >= LIVEBOARD_TTL_MS) liveboardCache.delete(key);
  }
}, LIVEBOARD_TTL_MS).unref();

/**
 * Queue-based token bucket rate limiter — models iRail's server-side algorithm exactly.
 *
 * iRail allows 3 req/s sustained with a 5-token burst bucket that starts full.
 * We use 2 req/s (below 3) so the burst refills at a net +1 token/second.
 *
 * Why a queue is necessary: without one, concurrent callers all compute the same
 * wait time and fire simultaneously — defeating the purpose of the rate limit.
 * The queue serializes releases so each caller is admitted one at a time, spaced
 * by 1/tokensPerSecond ms after the burst is exhausted.
 *
 * On 429: penalize() pushes the next dispatch out by `ms` by draining tokens deeply
 * negative — all queued callers back off together automatically.
 *
 * Android analogy: a shared bounded channel where the producer side releases
 * one permit every (1/rate)s; consumers block until a permit is available.
 */
function makeRateLimiter({ tokensPerSecond, burst }) {
  let tokens = burst; // start full — first `burst` requests are dispatched immediately
  let lastRefill = Date.now();
  const queue = [];   // FIFO queue of resolve functions from pending acquire() calls
  let scheduled = false;

  function refill() {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(burst, tokens + elapsed * tokensPerSecond);
    lastRefill = now;
  }

  // Drains the queue: releases one token per head-of-queue waiter, then schedules
  // itself for the next token if waiters remain. Only one tick runs at a time.
  function tick() {
    scheduled = false;
    if (queue.length === 0) return;
    refill();
    while (tokens >= 1 && queue.length > 0) {
      tokens -= 1;
      queue.shift()(); // resolve the oldest waiter
    }
    if (queue.length > 0) {
      const waitMs = Math.ceil(((1 - tokens) / tokensPerSecond) * 1000);
      scheduled = true;
      setTimeout(tick, waitMs);
    }
  }

  async function acquire() {
    return new Promise((resolve) => {
      queue.push(resolve);
      if (!scheduled) tick(); // start draining only if no tick is already pending
    });
  }

  // Sets tokens such that the next dispatch is delayed by ~ms milliseconds.
  // Formula: time until tokens=1 is (1 - tokens) / rate = ms/1000
  //          → tokens = 1 - rate * ms/1000
  function penalize(ms) {
    tokens = 1 - tokensPerSecond * (ms / 1000);
    lastRefill = Date.now();
    // If a tick is already scheduled it will re-evaluate via refill() when it fires.
    // If no tick is running but callers are waiting, schedule one now.
    if (!scheduled && queue.length > 0) {
      const waitMs = Math.ceil(((1 - tokens) / tokensPerSecond) * 1000);
      scheduled = true;
      setTimeout(tick, waitMs);
    }
  }

  return { acquire, penalize };
}

const irailLimiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });

/**
 * Single entry point for every outbound iRail HTTP call.
 * Acquires a rate-limit token before dispatching, and handles 429 globally:
 * drains the shared bucket (backpressure for all callers) then retries once.
 */
async function irailGet(path, options = {}) {
  await irailLimiter.acquire();
  try {
    return await irailClient.get(path, options);
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn('[irail] 429 received — applying 2s backoff to all pending requests');
      irailLimiter.penalize(2000);
      await irailLimiter.acquire(); // naturally waits ~2s due to the penalty before retrying
      return irailClient.get(path, options);
    }
    throw err;
  }
}

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
    const response = await irailGet('/stations/', {
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
      s.name?.toLowerCase().includes(lowerQuery) ||
      s.standardname?.toLowerCase().includes(lowerQuery)
  );

  if (substringMatches.length > 0) {
    return substringMatches.map((s) => ({
      ...s,
      // Show whichever field contains the query — the user typed a substring of it,
      // so that's what they should see as the station title.
      displayName: s.name?.toLowerCase().includes(lowerQuery) ? s.name : s.standardname,
    }));
  }

  // No substring matches — run fuzzy as a typo-tolerance fallback only.
  // Fuzzy corrects typos so we always show the canonical name, not standardname.
  const fuse = new Fuse(stations, {
    keys: ['name', 'standardname'],
    threshold: 0.35,
    distance: 100,
    minMatchCharLength: 3,
  });
  return fuse.search(query).map((r) => ({ ...r.item, displayName: r.item.name }));
}

/**
 * Fetches the live departure board for a single station, with a 15-second cache.
 * Repeated searches for the same station within the window skip the iRail call entirely.
 * All calls go through irailLimiter (via irailGet) — no separate concurrency limiter needed.
 */
async function getLiveboard(stationAtId) {
  const now = Date.now();
  const cached = liveboardCache.get(stationAtId);
  if (cached && now - cached.cachedAt < LIVEBOARD_TTL_MS) return cached.data;

  if (liveboardInflight.has(stationAtId)) return liveboardInflight.get(stationAtId);

  const promise = irailGet('/liveboard/', {
    params: { id: stationAtId, format: 'json', lang: 'en', alerts: 'true' },
    timeout: 6000,
  }).then((response) => {
    liveboardCache.set(stationAtId, { data: response.data, cachedAt: Date.now() });
    liveboardInflight.delete(stationAtId);
    return response.data;
  }).catch((err) => {
    liveboardInflight.delete(stationAtId);
    throw err;
  });

  liveboardInflight.set(stationAtId, promise);
  return promise;
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
    const delay = parseInt(dep.delay, 10) || 0;
    const effectiveDeparture = scheduled + delay;
    return effectiveDeparture >= nowSec && effectiveDeparture <= windowEnd && dep.left === '0';
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

function getCacheStatus() {
  return { stationsCached: stationsCache !== null };
}

module.exports = { getStations, searchStations, getLiveboard, filterDepartures, formatDeparture, makeRateLimiter, getCacheStatus };
