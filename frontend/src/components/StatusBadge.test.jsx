import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepartureList from './DepartureList.jsx';

// StatusBadge is internal to DepartureList — test it through a full station render.
function renderWithStation(departures) {
  const results = {
    query: 'Bru',
    generatedAt: new Date().toISOString(),
    stations: [{ stationId: 's1', stationName: 'Test Station', departures }],
  };
  render(
    <DepartureList results={results} error={null} isLoading={false} isStreaming={false} retryCount={0} />
  );
}

describe('StatusBadge (via DepartureList)', () => {
  it('C1 — delay=0, not cancelled → "On Time"', () => {
    renderWithStation([{
      trainNumber: 'IC1', destination: 'X', scheduledTime: '10:00',
      scheduledTimestamp: Date.now() / 1000 + 300, delayMinutes: 0, cancelled: false,
    }]);
    expect(screen.getByText('On Time')).toBeInTheDocument();
  });

  it('C2 — delay > 0, not cancelled → "Delayed"', () => {
    renderWithStation([{
      trainNumber: 'IC1', destination: 'X', scheduledTime: '10:00',
      scheduledTimestamp: Date.now() / 1000 + 300, delayMinutes: 5, cancelled: false,
    }]);
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });

  it('C3 — cancelled → "Cancelled" regardless of delay', () => {
    renderWithStation([{
      trainNumber: 'IC1', destination: 'X', scheduledTime: '10:00',
      scheduledTimestamp: Date.now() / 1000 + 300, delayMinutes: 0, cancelled: true,
    }]);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('C4 — cancelled with delay → "Cancelled" wins over "Delayed"', () => {
    renderWithStation([{
      trainNumber: 'IC1', destination: 'X', scheduledTime: '10:00',
      scheduledTimestamp: Date.now() / 1000 + 300, delayMinutes: 10, cancelled: true,
    }]);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Delayed')).not.toBeInTheDocument();
  });
});
