import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DepartureList from './DepartureList.jsx';
import { makeStation, makeResults, makeDeparture } from '../test/testHelpers.js';

const baseProps = { results: null, error: null, isLoading: false, showRefresh: false, onRefresh: vi.fn() };

describe('DepartureList — render states', () => {
  it('C5 — isLoading + no results → spinner shown', () => {
    render(<DepartureList {...baseProps} isLoading={true} />);
    expect(screen.getByText('Fetching departures…')).toBeInTheDocument();
  });

  it('C6 — error prop → error banner with the message', () => {
    render(<DepartureList {...baseProps} error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('C7 — idle (no results, no error, not loading) → search prompt', () => {
    render(<DepartureList {...baseProps} />);
    expect(screen.getByText('Search for a station')).toBeInTheDocument();
  });

  it('C8 — zero stations → "No stations found" message', () => {
    const results = makeResults({ query: 'zzz', stations: [] });
    render(<DepartureList {...baseProps} results={results} />);
    expect(screen.getByText(/No stations found matching/)).toBeInTheDocument();
  });

  it('C9 — results with stations → station name rendered', () => {
    const results = makeResults({
      stations: [makeStation({ stationId: 's1', stationName: 'Gent-Sint-Pieters' })],
    });
    render(<DepartureList {...baseProps} results={results} />);
    expect(screen.getByText('Gent-Sint-Pieters')).toBeInTheDocument();
  });

  it('C10 — cards sorted by earliest departure regardless of station order in response', () => {
    const now = Math.floor(Date.now() / 1000);
    const results = makeResults({
      stations: [
        makeStation({ stationId: 'late', stationName: 'Late Station', departures: [makeDeparture({ scheduledTimestamp: now + 800 })] }),
        makeStation({ stationId: 'early', stationName: 'Early Station', departures: [makeDeparture({ scheduledTimestamp: now + 300 })] }),
      ],
    });
    render(<DepartureList {...baseProps} results={results} />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('Early Station');
    expect(headings[1]).toHaveTextContent('Late Station');
  });

  it('C11 — stations with no departures appear after stations with departures', () => {
    const now = Math.floor(Date.now() / 1000);
    const results = makeResults({
      stations: [
        makeStation({ stationId: 'empty', stationName: 'Empty Station', departures: [] }),
        makeStation({ stationId: 'has-deps', stationName: 'Active Station', departures: [makeDeparture({ scheduledTimestamp: now + 300 })] }),
      ],
    });
    render(<DepartureList {...baseProps} results={results} />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('Active Station');
    expect(headings[1]).toHaveTextContent('Empty Station');
  });
});

describe('DepartureList — Refresh button', () => {
  const resultsWithStation = makeResults({
    stations: [makeStation({ stationId: 's1', stationName: 'Gent' })],
  });

  it('C12 — Refresh button renders when showRefresh is true', () => {
    render(<DepartureList {...baseProps} results={resultsWithStation} showRefresh={true} />);
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });

  it('C13 — Refresh button absent when showRefresh is false', () => {
    render(<DepartureList {...baseProps} results={resultsWithStation} showRefresh={false} />);
    expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
  });

  it('C14 — clicking Refresh calls onRefresh', async () => {
    const onRefresh = vi.fn();
    render(<DepartureList {...baseProps} results={resultsWithStation} showRefresh={true} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
