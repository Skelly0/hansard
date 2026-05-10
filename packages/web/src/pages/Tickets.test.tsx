import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tickets } from './Tickets';
import { useTicketCategories, useTicketMetrics, useTickets } from '../api/hooks/useTickets';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../api/hooks/useTickets', () => ({
  useTickets: vi.fn(),
  useTicketCategories: vi.fn(),
  useTicketMetrics: vi.fn(),
}));

describe('Tickets', () => {
  beforeEach(() => {
    vi.mocked(useTicketCategories).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useTicketMetrics).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
  });

  it('shows the full ticket description in the tickets list', () => {
    const description = [
      'The petitioner requests a complete review of the disputed order.',
      'They supplied names, dates, prior rulings, and a long explanation that should remain visible.',
    ].join('\n');

    vi.mocked(useTickets).mockReturnValue({
      data: {
        data: [
          {
            id: 'ticket-1',
            number: 12,
            categoryId: 'category-1',
            title: 'Review disputed order',
            description,
            status: 'open',
            priority: 'normal',
            tags: [],
            linkedTicketIds: [],
            createdById: 'player-1',
            createdAt: '2026-05-01T12:00:00.000Z',
            updatedAt: '2026-05-01T12:00:00.000Z',
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<Tickets />);

    expect(screen.getByText((_, element) => element?.textContent === description)).toBeInTheDocument();
  });
});
