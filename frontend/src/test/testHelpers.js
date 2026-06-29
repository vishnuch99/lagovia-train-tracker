/**
 * Test helpers for the JSON API architecture.
 *
 * These helpers build the plain JS objects that the hook and components
 * consume — matching the shapes returned by GET /departures and its error
 * responses. No SSE, no streams.
 */

export function makeErrorResponse(bodyObj, status = 400) {
  return {
    ok: false,
    status,
    json() { return Promise.resolve(bodyObj); },
  };
}

export function makeJsonResponse(bodyObj) {
  return {
    ok: true,
    status: 200,
    json() { return Promise.resolve(bodyObj); },
  };
}

export function makeDeparture(overrides = {}) {
  return {
    trainNumber: overrides.trainNumber ?? 'IC1234',
    destination: overrides.destination ?? 'Antwerpen-Centraal',
    scheduledTime: overrides.scheduledTime ?? '10:00',
    scheduledTimestamp: overrides.scheduledTimestamp ?? Math.floor(Date.now() / 1000) + 300,
    delayMinutes: overrides.delayMinutes ?? 0,
    cancelled: overrides.cancelled ?? false,
    platform: overrides.platform ?? null,
  };
}

export function makeStation(overrides = {}) {
  return {
    stationId: overrides.stationId ?? 'BE.NMBS.test',
    stationName: overrides.stationName ?? 'Test Station',
    departures: overrides.departures ?? [],
    ...(overrides.fetchError ? { fetchError: overrides.fetchError } : {}),
  };
}

export function makeResults(overrides = {}) {
  return {
    query: overrides.query ?? 'Bru',
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    stations: overrides.stations ?? [],
  };
}
