import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepartureList from './DepartureList.jsx';

const baseProps = { results: null, error: null, isLoading: false, isStreaming: false, retryCount: 0 };

describe('DepartureList — render states', () => {
  it('C5 — isLoading + no results → spinner shown', () => {
    render(<DepartureList {...baseProps} isLoading={true} />);
    expect(screen.getByText('Looking up departures…')).toBeInTheDocument();
  });

  it('C6 — isLoading + retryCount > 0 → retry message', () => {
    render(<DepartureList {...baseProps} isLoading={true} retryCount={1} />);
    expect(screen.getByText(/Retrying/)).toBeInTheDocument();
    expect(screen.getByText(/attempt 2 of 4/)).toBeInTheDocument();
  });

  it('C7 — error prop → error banner with the message', () => {
    render(<DepartureList {...baseProps} error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('C8 — idle (no results, no error, not loading) → search prompt', () => {
    render(<DepartureList {...baseProps} />);
    expect(screen.getByText('Search for a station')).toBeInTheDocument();
  });

  it('C9 — results + isStreaming → "Loading more stations…" footer', () => {
    const results = {
      query: 'Bru', generatedAt: new Date().toISOString(),
      stations: [{ stationId: 's1', stationName: 'Brussel', departures: [] }],
    };
    render(<DepartureList {...baseProps} results={results} isStreaming={true} />);
    expect(screen.getByText('Loading more stations…')).toBeInTheDocument();
  });

  it('C10 — results + not streaming → footer gone', () => {
    const results = {
      query: 'Bru', generatedAt: new Date().toISOString(),
      stations: [{ stationId: 's1', stationName: 'Brussel', departures: [] }],
    };
    render(<DepartureList {...baseProps} results={results} isStreaming={false} />);
    expect(screen.queryByText('Loading more stations…')).not.toBeInTheDocument();
  });

  it('C11 — zero stations + not streaming → "No stations found" message', () => {
    const results = { query: 'zzz', generatedAt: new Date().toISOString(), stations: [] };
    render(<DepartureList {...baseProps} results={results} />);
    expect(screen.getByText(/No stations found for/)).toBeInTheDocument();
  });
});
