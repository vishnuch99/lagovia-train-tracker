import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import express from 'express';

const require = createRequire(import.meta.url);
const departuresRouter = require('./departures.js');

const app = express();
app.use('/departures', departuresRouter);

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// B11–B12  Input validation — checked before SSE headers are flushed
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
