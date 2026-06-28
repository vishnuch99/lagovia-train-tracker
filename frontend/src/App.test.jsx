import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { makeErrorResponse } from './test/sseHelpers.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App integration', () => {
  it('C12 — short query triggers 400, shows "Input is incomplete"', async () => {
    fetch.mockResolvedValue(
      makeErrorResponse({ error: 'Input is incomplete', code: 'QUERY_TOO_SHORT' }, 400)
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(screen.getByText('Input is incomplete')).toBeInTheDocument()
    );
  });

  it('C13 — clear button appears when input has text, disappears after clear', async () => {
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox');

    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
    await user.type(input, 'Bru');
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Clear search'));
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
