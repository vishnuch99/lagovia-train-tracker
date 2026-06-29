import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import express from 'express';

// Both the test and the router share the same CJS require cache, so spying on
// irail's exported properties is visible inside the route handler.
const require = createRequire(import.meta.url);
const irail = require('../services/irail.js');
const departuresRouter = require('./departures.js');

const app = express();
app.use('/departures', departuresRouter);

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// B11–B12  Input validation — no irail calls needed
// ---------------------------------------------------------------------------

describe('input validation', () => {
  it('B11 — query shorter than 3 chars → 400 QUERY_TOO_SHORT', async () => {
    const res = await request(app).get('/departures?q=ab');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUERY_TOO_SHORT');
    expect(res.body.error).toBe('Input is incomplete');
  });

  it('B12 — query longer than 100 chars → 400 QUERY_TOO_LONG', async () => {
    const longQuery = 'a'.repeat(101);
    const res = await request(app).get(`/departures?q=${longQuery}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUERY_TOO_LONG');
    expect(res.body.error).toBe('Query is too long');
  });
});

// ---------------------------------------------------------------------------
// B13  Happy path — mocked irail returns two stations
// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('B13 — valid query returns 200 with correct response shape', async () => {
    vi.spyOn(irail, 'getStations').mockResolvedValue([]);
    vi.spyOn(irail, 'searchStations').mockReturnValue([
      { '@id': 'id1', id: 'BE.NMBS.s1', displayName: 'Gent-Sint-Pieters' },
      { '@id': 'id2', id: 'BE.NMBS.s2', displayName: 'Gent-Dampoort' },
    ]);
    vi.spyOn(irail, 'getLiveboard').mockResolvedValue({ departures: { departure: [] } });
    vi.spyOn(irail, 'filterDepartures').mockReturnValue([]);

    const res = await request(app).get('/departures?q=Gen');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('Gen');
    expect(res.body.generatedAt).toBeDefined();
    expect(res.body.stations).toHaveLength(2);
    expect(res.body.stations[0].stationName).toBe('Gent-Sint-Pieters');
    expect(res.body.stations[1].stationName).toBe('Gent-Dampoort');
  });
});

// ---------------------------------------------------------------------------
// B14  Upstream failure — getStations throws → 502
// ---------------------------------------------------------------------------

describe('upstream failure', () => {
  it('B14 — getStations throws → 502 UPSTREAM_ERROR', async () => {
    vi.spyOn(irail, 'getStations').mockRejectedValue(new Error('iRail unreachable'));

    const res = await request(app).get('/departures?q=Bru');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_ERROR');
  });
});
