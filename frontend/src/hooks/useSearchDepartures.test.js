import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearchDepartures } from './useSearchDepartures.js';
import { makeSseResponse, makeErrorResponse, makeStation, makeDeparture, makeMeta } from '../test/sseHelpers.js';

// Returns a fresh SSE response on every call — avoids the locked-stream problem
// that occurs when the same Response object is returned on retries.
function sseImpl(events) {
  return vi.fn().mockImplementation(() => Promise.resolve(makeSseResponse(events)));
}

// Fetch that hangs until the AbortSignal fires, then rejects — mirrors real fetch behavior.
function hangingFetchImpl(_url, { signal }) {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError'))
    );
  });
}

function submission(query = 'Bru') {
  return { query, id: Date.now() };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// F1–F2  Fetch URL
// ---------------------------------------------------------------------------

describe('fetch URL', () => {
  it('F1 — submitting a query calls fetch with the correct URL', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
    );
    const sub = submission('Bru');
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledWith('/departures?q=Bru', expect.any(Object));
  });

  it('F2 — accented characters are URL-encoded', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
    );
    const sub = submission('Liège');
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('Li%C3%A8ge'),
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// F3  Connect timeout triggers retry
// ---------------------------------------------------------------------------

describe('connect timeout', () => {
  it('F3 — fetch hanging 10s triggers connect timeout and retry', async () => {
    vi.useFakeTimers();
    fetch
      .mockImplementationOnce(hangingFetchImpl)  // attempt 1: hangs until signal aborts
      .mockImplementation(() =>                  // attempt 2: success
        Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
      );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers(); // restore so waitFor can poll with real setInterval
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// F4  Network error — retries — final error
// ---------------------------------------------------------------------------

describe('network failure', () => {
  it('F4 — fetch always throws TypeError → error shown after 4 attempts', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// F5–F7  Malformed / unexpected stream data
// ---------------------------------------------------------------------------

describe('malformed stream data', () => {
  it('F5 — invalid JSON in stream does not crash', async () => {
    vi.useFakeTimers();
    const badChunk = new TextEncoder().encode('data: {bad json}\n\n');
    const badStreamResponse = () => Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let sent = false;
          return {
            read() {
              if (!sent) { sent = true; return Promise.resolve({ done: false, value: badChunk }); }
              return Promise.resolve({ done: true, value: undefined });
            },
            cancel() {},
          };
        },
      },
    });
    fetch
      .mockImplementationOnce(badStreamResponse)
      .mockImplementation(() =>
        Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
      );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    // Either settled with results or error — must not be in loading state indefinitely
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('F6 — station event with missing departures field does not crash', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta(),
          { type: 'station', stationId: 'x', stationName: 'X' }, // no departures key
          { type: 'done' },
        ])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('F7 — unknown event type is silently ignored', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 0 }),
          { type: 'future_unknown_event', payload: 'ignored' },
          { type: 'done' },
        ])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F8  HTTP 400 — backend validation error
// ---------------------------------------------------------------------------

describe('HTTP 400', () => {
  it('F8 — 400 response shows exact backend error message, no retry', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(makeErrorResponse({ error: 'Input is incomplete', code: 'QUERY_TOO_SHORT' }, 400))
    );
    const sub = submission('ab');
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBe('Input is incomplete'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F9–F10  Happy path + empty station card
// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('F9 — full stream renders both station cards', async () => {
    const dep = makeDeparture({ scheduledTimestamp: Math.floor(Date.now() / 1000) + 300 });
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 2 }),
          makeStation({ stationId: 's1', stationName: 'Gent', departures: [dep] }),
          makeStation({ stationId: 's2', stationName: 'Brussel', departures: [dep] }),
          { type: 'done' },
        ])
      )
    );
    const sub = submission('Gen');
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.results.stations).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('F10 — station with no departures is included in results', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 1 }),
          makeStation({ stationId: 's1', stationName: 'Empty Station', departures: [] }),
          { type: 'done' },
        ])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.results.stations).toHaveLength(1);
    expect(result.current.results.stations[0].departures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F11  Re-submit same query → fresh fetch
// ---------------------------------------------------------------------------

describe('re-submit', () => {
  it('F11 — same query with new id triggers a second fetch call', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
    );
    const { rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: { query: 'Bru', id: 1 } },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ sub: { query: 'Bru', id: 2 } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// F12–F13  Station sort order (case 17)
// ---------------------------------------------------------------------------

describe('station sort order', () => {
  it('F12 — station with earlier departure appears first regardless of stream order', async () => {
    const now = Math.floor(Date.now() / 1000);
    const earlyDep = makeDeparture({ scheduledTimestamp: now + 600 });
    const lateDep = makeDeparture({ scheduledTimestamp: now + 3600 });
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 2 }),
          makeStation({ stationId: 'late', departures: [lateDep] }),   // arrives first in stream
          makeStation({ stationId: 'early', departures: [earlyDep] }), // arrives second
          { type: 'done' },
        ])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() =>
      expect(result.current.results?.stations).toHaveLength(2)
    );
    expect(result.current.results.stations[0].stationId).toBe('early');
    expect(result.current.results.stations[1].stationId).toBe('late');
  });

  it('F13 — stations with no departures appear after stations with departures', async () => {
    const now = Math.floor(Date.now() / 1000);
    const dep = makeDeparture({ scheduledTimestamp: now + 600 });
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 2 }),
          makeStation({ stationId: 'empty', departures: [] }),
          makeStation({ stationId: 'has-deps', departures: [dep] }),
          { type: 'done' },
        ])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() =>
      expect(result.current.results?.stations).toHaveLength(2)
    );
    expect(result.current.results.stations[0].stationId).toBe('has-deps');
    expect(result.current.results.stations[1].stationId).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// F14–F15  Retry logic
// ---------------------------------------------------------------------------

describe('retry logic', () => {
  it('F14 — fails twice then succeeds on 3rd attempt', async () => {
    vi.useFakeTimers();
    fetch
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementation(() =>
        Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
      );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('F15 — all 4 attempts fail → error message shown, loading stopped', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await act(async () => { await vi.runAllTimersAsync(); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// F16  Mid-stream drop — graceful degradation
// ---------------------------------------------------------------------------

describe('mid-stream drop', () => {
  it('F16 — connection closes without "done"; partial results kept, no retry', async () => {
    const dep = makeDeparture({ scheduledTimestamp: Math.floor(Date.now() / 1000) + 300 });
    const enc = new TextEncoder();
    const chunks = [
      enc.encode(`data: ${JSON.stringify(makeMeta({ totalStationsMatched: 3 }))}\n\n`),
      enc.encode(`data: ${JSON.stringify(makeStation({ stationId: 's1', departures: [dep] }))}\n\n`),
      // no 'done' chunk — stream drops after 2 chunks
    ];
    fetch.mockImplementation(() => Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let i = 0;
          return {
            read() {
              if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
              return Promise.resolve({ done: true, value: undefined }); // stream ends abruptly
            },
            cancel() {},
          };
        },
      },
    }));
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.results.stations).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F17  SSE error event from server
// ---------------------------------------------------------------------------

describe('SSE error event', () => {
  it('F17 — server streams type:error → error state shown', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([{ type: 'error', error: 'Failed to reach the iRail upstream API' }])
      )
    );
    const sub = submission();
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F18  Zero stations matched
// ---------------------------------------------------------------------------

describe('zero stations matched', () => {
  it('F18 — zero totalStationsMatched followed by done → empty stations array', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }])
      )
    );
    const sub = submission('zzz');
    const { result } = renderHook(() => useSearchDepartures(sub));
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.stations).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F19  Stale request discarded when query changes
// ---------------------------------------------------------------------------

describe('stale request cancellation', () => {
  it('F19 — switching query before first response discards the stale result', async () => {
    let resolveA;
    const dep = makeDeparture({ scheduledTimestamp: Math.floor(Date.now() / 1000) + 300 });
    fetch
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r; })) // A hangs
      .mockImplementation(() =>
        Promise.resolve(
          makeSseResponse([
            makeMeta({ totalStationsMatched: 1 }),
            makeStation({ stationId: 'b', departures: [dep] }),
            { type: 'done' },
          ])
        )
      );

    const { result, rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: { query: 'Ant', id: 1 } },
    });

    rerender({ sub: { query: 'Bru', id: 2 } }); // switch to B before A resolves
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    // Now resolve A with a different station — should be ignored
    act(() => {
      resolveA(
        makeSseResponse([
          makeMeta({ totalStationsMatched: 1 }),
          makeStation({ stationId: 'a', departures: [] }),
          { type: 'done' },
        ])
      );
    });

    await waitFor(() => expect(result.current.results).toBeTruthy());
    const ids = result.current.results.stations.map((s) => s.stationId);
    expect(ids).not.toContain('a');
    expect(ids).toContain('b');
  });
});

// ---------------------------------------------------------------------------
// F20  Clear resets to idle
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('F20 — null submission resets results, error, and loading to idle', async () => {
    fetch.mockImplementation(() =>
      Promise.resolve(makeSseResponse([makeMeta({ totalStationsMatched: 0 }), { type: 'done' }]))
    );
    const { result, rerender } = renderHook(({ sub }) => useSearchDepartures(sub), {
      initialProps: { sub: submission() },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ sub: null });
    await waitFor(() => expect(result.current.results).toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
