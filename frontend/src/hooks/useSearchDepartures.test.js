import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSearchDepartures } from './useSearchDepartures.js';
import { makeJsonResponse, makeErrorResponse, makeStation, makeResults, makeDeparture } from '../test/testHelpers.js';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// F1–F2  Fetch URL
// ---------------------------------------------------------------------------

describe('fetch URL', () => {
  it('F1 — submitting a query calls fetch with the correct URL', async () => {
    fetch.mockResolvedValue(makeJsonResponse(makeResults()));
    const sub = { query: 'Bru', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledWith('/departures?q=Bru', expect.any(Object));
  });

  it('F2 — accented characters are URL-encoded', async () => {
    fetch.mockResolvedValue(makeJsonResponse(makeResults()));
    const sub = { query: 'Liège', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('Li%C3%A8ge'),
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// F3  Null submission → idle, no fetch
// ---------------------------------------------------------------------------

describe('null submission', () => {
  it('F3 — null submission stays idle, fetch never called', () => {
    const { result } = renderHook(() => useSearchDepartures(null));
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F4  HTTP 400 — backend validation error
// ---------------------------------------------------------------------------

describe('HTTP 400', () => {
  it('F4 — 400 QUERY_TOO_SHORT → friendly message, no retry', async () => {
    fetch.mockResolvedValue(
      makeErrorResponse({ error: 'Input is incomplete', code: 'QUERY_TOO_SHORT' }, 400)
    );
    const sub = { query: 'ab', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBe('Enter at least 3 characters to search.'));
    expect(result.current.isLoading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F5–F6  Happy path
// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('F5 — full response populates all stations', async () => {
    const dep = makeDeparture();
    const data = makeResults({
      stations: [
        makeStation({ stationId: 's1', stationName: 'Gent', departures: [dep] }),
        makeStation({ stationId: 's2', stationName: 'Brussel', departures: [dep] }),
      ],
    });
    fetch.mockResolvedValue(makeJsonResponse(data));
    const sub = { query: 'Gen', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.stations).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('F6 — station with no departures is included in results', async () => {
    const data = makeResults({
      stations: [makeStation({ stationId: 's1', stationName: 'Empty Station', departures: [] })],
    });
    fetch.mockResolvedValue(makeJsonResponse(data));
    const sub = { query: 'Bru', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.stations).toHaveLength(1);
    expect(result.current.results.stations[0].departures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F7  Network failure
// ---------------------------------------------------------------------------

describe('network failure', () => {
  it('F7 — fetch throws TypeError → error shown, loading stopped', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const sub = { query: 'Bru', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F8  Upstream error (502)
// ---------------------------------------------------------------------------

describe('upstream error', () => {
  it('F8 — 502 UPSTREAM_ERROR → friendly message shown', async () => {
    fetch.mockResolvedValue(
      makeErrorResponse(
        { error: 'Failed to reach the iRail upstream API', code: 'UPSTREAM_ERROR' },
        502
      )
    );
    const sub = { query: 'Bru', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBe('The Belgian railway service is unreachable right now. Please try again in a moment.');
    expect(result.current.isLoading).toBe(false);
  });

  it('F9 — non-OK response with unknown code → generic fallback message', async () => {
    fetch.mockResolvedValue(makeErrorResponse({}, 500));
    const sub = { query: 'Bru', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBe('Something went wrong. Please try again.');
  });
});

// ---------------------------------------------------------------------------
// F10  Zero stations matched
// ---------------------------------------------------------------------------

describe('zero stations', () => {
  it('F10 — zero stations in response → empty array, no error', async () => {
    fetch.mockResolvedValue(makeJsonResponse(makeResults({ stations: [] })));
    const sub = { query: 'zzz', id: 1 };
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.stations).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F11  Re-submit same query → fresh fetch
// ---------------------------------------------------------------------------

describe('re-submit', () => {
  it('F11 — same query with new id triggers a second fetch', async () => {
    fetch.mockResolvedValue(makeJsonResponse(makeResults()));
    const { rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: { query: 'Bru', id: 1 } },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ sub: { query: 'Bru', id: 2 } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// F12  Stale request discarded when query changes
// ---------------------------------------------------------------------------

describe('stale request cancellation', () => {
  it('F12 — switching query before response resolves discards the stale result', async () => {
    let resolveA;
    const dataB = makeResults({ stations: [makeStation({ stationId: 'b' })] });
    fetch
      .mockImplementationOnce((_url, { signal }) =>
        new Promise((resolve, reject) => {
          resolveA = resolve;
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
      )
      .mockImplementation(() => Promise.resolve(makeJsonResponse(dataB)));

    const { result, rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: { query: 'Ant', id: 1 } },
    });

    rerender({ sub: { query: 'Bru', id: 2 } }); // aborts A, starts B
    await waitFor(() => expect(result.current.results).not.toBeNull());

    // Resolve A after B has already landed — should have no effect
    resolveA(makeJsonResponse(makeResults({ stations: [makeStation({ stationId: 'a' })] })));
    await new Promise((r) => setTimeout(r, 50));

    const ids = result.current.results.stations.map((s) => s.stationId);
    expect(ids).toContain('b');
    expect(ids).not.toContain('a');
  });
});

// ---------------------------------------------------------------------------
// F13  Clear resets to idle
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('F13 — null submission resets results, error, and loading to idle', async () => {
    fetch.mockResolvedValue(makeJsonResponse(makeResults()));
    const { result, rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: { query: 'Bru', id: 1 } },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ sub: null });
    await waitFor(() => expect(result.current.results).toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
