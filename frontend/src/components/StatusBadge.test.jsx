import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepartureList from './DepartureList.jsx';
import { makeResults, makeDeparture } from '../test/testHelpers.js';

// StatusBadge is internal to DepartureList — test it through a full station render.
function renderWithStation(departures) {
  const results = makeResults({
    stations: [{ stationId: 's1', stationName: 'Test Station', departures }],
  });
  render(<DepartureList results={results} error={null} isLoading={false} />);
}

describe('StatusBadge (via DepartureList)', () => {
  it('C1 — delay=0, not cancelled → "On Time"', () => {
    renderWithStation([makeDeparture({ delayMinutes: 0, cancelled: false })]);
    expect(screen.getByText('On Time')).toBeInTheDocument();
  });

  it('C2 — delay > 0, not cancelled → "Delayed"', () => {
    renderWithStation([makeDeparture({ delayMinutes: 5, cancelled: false })]);
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });

  it('C3 — cancelled → "Cancelled" regardless of delay', () => {
    renderWithStation([makeDeparture({ delayMinutes: 0, cancelled: true })]);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('C4 — cancelled with delay → "Cancelled" wins over "Delayed"', () => {
    renderWithStation([makeDeparture({ delayMinutes: 10, cancelled: true })]);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Delayed')).not.toBeInTheDocument();
  });
});
