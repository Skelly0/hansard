import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Offices } from './Offices';
import { useOffices } from '../api/hooks/useOffices';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/players/player-1">{children}</a>,
}));

vi.mock('../api/hooks/useOffices', () => ({
  useOffices: vi.fn(),
}));

describe('Offices', () => {
  it('shows the current holder name returned by the offices API', () => {
    vi.mocked(useOffices).mockReturnValue({
      data: [
        {
          id: 'office-1',
          name: 'First Minister',
          tier: 'head_of_government',
          factionId: null,
          maxHolders: 1,
          permissions: null,
          filledBy: 'appointed',
          appointableBy: null,
          requiresConfirmation: false,
          discordRoleId: null,
          isActive: true,
          sortOrder: 1,
          currentHolders: [
            {
              id: 'holder-1',
              officeId: 'office-1',
              playerId: 'player-1',
              playerName: 'Ada Lovelace',
              discordUsername: 'ada',
              startDate: '2026-05-01T00:00:00.000Z',
              endDate: null,
              appointedBy: null,
              appointmentMethod: 'appointed',
              electionId: null,
              removalReason: null,
              removedById: null,
              simTick: null,
              simDate: null,
            },
          ],
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<Offices />);

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });
});
