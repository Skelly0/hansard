import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './CommandPalette';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/hooks/useAuth', () => ({ useAuth: () => ({ user: null, isStaff: false }) }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
vi.mock('../../api/client', () => ({ api: { get: vi.fn() } }));

import { api } from '../../api/client';

const bill = (id: string) => ({ id, title: `Bill ${id}`, slug: id, billNumber: 1, status: 'submitted' });

describe('CommandPalette', () => {
  it('keeps the highlight on the same record when fresh results replace the old ones', async () => {
    let resolveFresh!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith('/bills?search=co&')) return Promise.resolve({ data: [bill('x1'), bill('x2'), bill('x3')], total: 3 });
      if (path.startsWith('/bills?search=coal&')) return new Promise((resolve) => { resolveFresh = resolve; });
      return Promise.resolve({ data: [], total: 0 });
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPalette open onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const input = screen.getByRole('combobox');
    const highlighted = () => document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent;

    fireEvent.change(input, { target: { value: 'co' } });
    await screen.findByText('Bill x3');

    // A new term: the previous results stay up as placeholders while it loads.
    fireEvent.change(input, { target: { value: 'coal' } });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([p]) => String(p).startsWith('/bills?search=coal&'))).toBe(true));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(highlighted()).toContain('Bill x3');

    // The fresh results reorder; the highlight follows the record, not the row.
    await act(async () => resolveFresh({ data: [bill('y1'), bill('x3'), bill('y2')], total: 3 }));
    await screen.findByText('Bill y2');
    expect(highlighted()).toContain('Bill x3');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { slug: 'x3' } }));
  });
});
