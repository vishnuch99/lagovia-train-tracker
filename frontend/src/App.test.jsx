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
  it('C12 — typing 3+ chars auto-submits after debounce without a Search button', async () => {
    fetch.mockResolvedValue(
      makeErrorResponse({ error: 'Query is too long', code: 'QUERY_TOO_LONG' }, 400)
    );

    render(<App />);
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Bru');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
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
