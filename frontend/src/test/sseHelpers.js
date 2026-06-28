/**
 * Test helpers for useSearchDepartures.
 *
 * Rather than using real Response + ReadableStream (which have jsdom compatibility
 * issues), these helpers return plain JS objects that satisfy the duck-typed
 * interface the hook actually uses:
 *   - response.ok, response.status
 *   - response.json()       (for error responses)
 *   - response.body.getReader() → { read(), cancel() }  (for SSE responses)
 *
 * Each call returns a fresh object with independent state — no locked-stream issues
 * when the hook retries and calls fetch multiple times.
 */

const encoder = new TextEncoder();

export function makeSseResponse(events) {
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() {},
        };
      },
    },
  };
}

export function makeErrorResponse(bodyObj, status = 400) {
  return {
    ok: false,
    status,
    json() { return Promise.resolve(bodyObj); },
  };
}

/** Builds a station SSE event with sensible defaults. */
export function makeStation(overrides = {}) {
  return {
    type: 'station',
    stationId: overrides.stationId ?? 'BE.NMBS.00' + Math.random().toString(36).slice(2, 7),
    stationName: overrides.stationName ?? 'Test Station',
    departures: overrides.departures ?? [],
    fetchError: overrides.fetchError,
  };
}

/** Builds a formatted departure object (matches formatDeparture output shape). */
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

export function makeMeta(overrides = {}) {
  return {
    type: 'meta',
    query: overrides.query ?? 'Bru',
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    totalStationsMatched: overrides.totalStationsMatched ?? 1,
  };
}
