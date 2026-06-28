import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

// CJS source must be imported via createRequire from an ESM test file
const require = createRequire(import.meta.url);
const { searchStations, filterDepartures, formatDeparture, makeRateLimiter } = require('./irail.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStation(name, standardname) {
  return { '@id': `BE.NMBS.${name}`, id: name, name, standardname };
}

function makeDep(overrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    time: String(overrides.time ?? nowSec + 300),
    delay: String(overrides.delay ?? 0),
    vehicle: overrides.vehicle ?? 'BE.NMBS.IC1234',
    station: overrides.station ?? 'Antwerpen-Centraal',
    left: overrides.left ?? '0',
    canceled: overrides.canceled ?? '0',
    platform: overrides.platform ?? '1',
  };
}

// ---------------------------------------------------------------------------
// B1–B5  searchStations — displayName logic
// ---------------------------------------------------------------------------

describe('searchStations — displayName', () => {
  const stations = [
    makeStation('Brussels-Central', 'Brussel-Centraal/Bruxelles-Central'),
    makeStation('Gent-Sint-Pieters', 'Gent-Sint-Pieters'),
    makeStation('Antwerpen-Centraal', 'Antwerpen-Centraal'),
    makeStation('Namur', 'Namen'),
  ];

  it('B1 — query matches name → displayName = name', () => {
    const results = searchStations(stations, 'Brussels');
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe('Brussels-Central');
  });

  it('B2 — query matches standardname only → displayName = standardname', () => {
    // "lle" is in "Brussel-Centraal/Bruxelles-Central" but NOT in "Brussels-Central"
    const results = searchStations(stations, 'lle');
    const bxl = results.find((s) => s.name === 'Brussels-Central');
    expect(bxl).toBeDefined();
    expect(bxl.displayName).toBe('Brussel-Centraal/Bruxelles-Central');
  });

  it('B3 — both name and standardname match → displayName = name', () => {
    // "Gent" is in both name and standardname for Gent-Sint-Pieters
    const results = searchStations(stations, 'Gent');
    expect(results[0].displayName).toBe('Gent-Sint-Pieters');
  });

  it('B4 — no substring match → fuzzy runs, displayName = name', () => {
    // "Namuur" is a typo of "Namur" — fuzzy should catch it
    const results = searchStations(stations, 'Namuur');
    const namur = results.find((s) => s.name === 'Namur');
    expect(namur).toBeDefined();
    expect(namur.displayName).toBe('Namur');
  });

  it('B5 — no match at all → empty array', () => {
    const results = searchStations(stations, 'zzzzz');
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B6–B7  filterDepartures
// ---------------------------------------------------------------------------

describe('filterDepartures', () => {
  it('B6 — excludes trains outside the 15-minute window', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const deps = [
      makeDep({ time: nowSec + 100 }),   // inside
      makeDep({ time: nowSec + 1000 }),  // outside (>15 min)
      makeDep({ time: nowSec - 10 }),    // past
    ];
    const filtered = filterDepartures(deps);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].time).toBe(String(nowSec + 100));
  });

  it('B7 — excludes trains that have already left (left === "1")', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const deps = [
      makeDep({ time: nowSec + 100, left: '0' }),
      makeDep({ time: nowSec + 200, left: '1' }),
    ];
    const filtered = filterDepartures(deps);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].left).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// B8–B10  formatDeparture
// ---------------------------------------------------------------------------

describe('formatDeparture', () => {
  it('B8 — extracts train number from vehicle string', () => {
    const result = formatDeparture(makeDep({ vehicle: 'BE.NMBS.IC3033' }));
    expect(result.trainNumber).toBe('IC3033');
  });

  it('B9 — converts delay seconds to minutes', () => {
    const result = formatDeparture(makeDep({ delay: '180' }));
    expect(result.delayMinutes).toBe(3);
  });

  it('B10 — scheduledTimestamp is a number (required by frontend sort)', () => {
    const result = formatDeparture(makeDep({ time: '1700000000' }));
    expect(typeof result.scheduledTimestamp).toBe('number');
    expect(result.scheduledTimestamp).toBe(1700000000);
  });
});

// ---------------------------------------------------------------------------
// B14–B18  Rate limiter
// ---------------------------------------------------------------------------

describe('makeRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function resolveAll(limiter, count) {
    const timestamps = [];
    const start = Date.now();
    const promises = Array.from({ length: count }, async () => {
      await limiter.acquire();
      timestamps.push(Date.now() - start);
    });
    await vi.runAllTimersAsync();
    await Promise.all(promises);
    return timestamps;
  }

  it('B14 — first 5 calls resolve immediately (burst)', async () => {
    const limiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });
    const timestamps = await resolveAll(limiter, 5);
    for (const t of timestamps) expect(t).toBe(0);
  });

  it('B15 — 6th call resolves ≥500ms after burst is exhausted', async () => {
    const limiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });
    const timestamps = await resolveAll(limiter, 6);
    for (let i = 0; i < 5; i++) expect(timestamps[i]).toBe(0);
    expect(timestamps[5]).toBeGreaterThanOrEqual(500);
  });

  it('B16 — 8 calls: first 5 immediate, then one every ~500ms', async () => {
    const limiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });
    const timestamps = await resolveAll(limiter, 8);
    for (let i = 0; i < 5; i++) expect(timestamps[i]).toBe(0);
    expect(timestamps[5]).toBeGreaterThanOrEqual(500);
    expect(timestamps[6]).toBeGreaterThanOrEqual(1000);
    expect(timestamps[7]).toBeGreaterThanOrEqual(1500);
  });

  it('B17 — 15 calls: first 5 immediate, remainder at 500ms intervals', async () => {
    const limiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });
    const timestamps = await resolveAll(limiter, 15);
    for (let i = 0; i < 5; i++) expect(timestamps[i]).toBe(0);
    for (let i = 5; i < 15; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual((i - 4) * 500);
    }
  });

  it('B18 — penalize(2000) delays next acquire by ≥2000ms', async () => {
    const limiter = makeRateLimiter({ tokensPerSecond: 2, burst: 5 });
    await resolveAll(limiter, 5); // exhaust burst
    limiter.penalize(2000);
    const start = Date.now();
    const p = limiter.acquire().then(() => Date.now() - start);
    await vi.runAllTimersAsync();
    expect(await p).toBeGreaterThanOrEqual(2000);
  });
});
