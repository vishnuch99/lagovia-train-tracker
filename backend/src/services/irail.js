const axios = require('axios');
const Fuse = require('fuse.js');

const STATIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const LIVEBOARD_TTL_MS = 15 * 1000;

const irailClient = axios.create({
  baseURL: 'https://api.irail.be',
  headers: {
    'User-Agent': 'vishnu_dps/1.0 (chvishnu619@gmail.com)',
  },
});

let stationsCache = null;
let stationsCachedAt = 0;
let stationsEtag = null;

const liveboardCache = new Map();
const liveboardInflight = new Map();

// Evict stale liveboard entries every TTL interval so the Map stays bounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of liveboardCache) {
    if (now - val.cachedAt >= LIVEBOARD_TTL_MS) liveboardCache.delete(key);
  }
}, LIVEBOARD_TTL_MS).unref();

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
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });

    if (response.status === 304) {
      stationsCachedAt = Date.now();
      return stationsCache;
    }

    stationsCache = response.data.station;
    stationsCachedAt = Date.now();
    if (response.headers.etag) stationsEtag = response.headers.etag;
    return stationsCache;

  } catch (err) {
    if (stationsCache) {
      console.warn('[irail] Station refresh failed; serving stale cache:', err.message);
      return stationsCache;
    }
    throw err;
  }
}

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
      displayName: s.name?.toLowerCase().includes(lowerQuery) ? s.name : s.standardname,
    }));
  }

  const fuse = new Fuse(stations, {
    keys: ['name', 'standardname'],
    threshold: 0.35,
    distance: 100,
    minMatchCharLength: 3,
  });
  return fuse.search(query).map((r) => ({ ...r.item, displayName: r.item.name }));
}

async function getLiveboard(stationAtId) {
  const now = Date.now();
  const cached = liveboardCache.get(stationAtId);
  if (cached && now - cached.cachedAt < LIVEBOARD_TTL_MS) return cached.data;

  // Deduplicate concurrent requests for the same station.
  if (liveboardInflight.has(stationAtId)) return liveboardInflight.get(stationAtId);

  const promise = irailClient.get('/liveboard/', {
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

function formatDeparture(dep) {
  const scheduledTimestamp = parseInt(dep.time, 10);
  const delaySeconds = parseInt(dep.delay, 10) || 0;
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

module.exports = { getStations, searchStations, getLiveboard, filterDepartures, formatDeparture, getCacheStatus };
