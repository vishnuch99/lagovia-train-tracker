const axios = require('axios');
const Fuse = require('fuse.js');

const IRAIL_BASE = 'https://api.irail.be';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — station list changes rarely

let stationsCache = null;
let stationsCachedAt = 0;

/**
 * Fetches the full list of Belgian stations from iRail.
 * Results are cached in memory for CACHE_TTL_MS to avoid hammering the API.
 * Android analogy: this is the Repository layer with a simple in-memory cache.
 */
async function getStations() {
  const now = Date.now();
  if (stationsCache && now - stationsCachedAt < CACHE_TTL_MS) {
    return stationsCache;
  }

  const response = await axios.get(`${IRAIL_BASE}/stations/`, {
    params: { format: 'json', lang: 'en' },
    timeout: 8000,
  });

  stationsCache = response.data.station;
  stationsCachedAt = Date.now();
  return stationsCache;
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
 * Fetches the live departure board for a single station.
 * Uses the station's @id URI (the canonical identifier iRail uses internally).
 */
async function getLiveboard(stationAtId) {
  const response = await axios.get(`${IRAIL_BASE}/liveboard/`, {
    params: { id: stationAtId, format: 'json', lang: 'en', alerts: 'true' },
    timeout: 6000,
  });
  return response.data;
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
