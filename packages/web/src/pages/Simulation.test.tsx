import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from './Simulation';
import {
  useAdvancePreview,
  useAdvanceTime,
  useAssignAilment,
  useHealCharacter,
  useKillCharacter,
  useSimEvents,
  useSimulationClock,
  useTimeAdvanceHistory,
  useUpdateClock,
} from '../api/hooks/useSimulation';
import { usePlayer, useSearchPlayers } from '../api/hooks/usePlayers';
import { useAuth } from '../api/hooks/useAuth';

vi.mock('../api/hooks/useSimulation', () => ({
  useSimulationClock: vi.fn(),
  useTimeAdvanceHistory: vi.fn(),
  useAdvancePreview: vi.fn(),
  useAdvanceTime: vi.fn(),
  useAssignAilment: vi.fn(),
  useHealCharacter: vi.fn(),
  useKillCharacter: vi.fn(),
  useSimEvents: vi.fn(),
  useUpdateClock: vi.fn(),
}));

vi.mock('../api/hooks/usePlayers', () => ({
  useSearchPlayers: vi.fn(),
  usePlayer: vi.fn(),
}));

vi.mock('../api/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

function basePreview(overrides: Record<string, unknown> = {}) {
  return {
    preview: true,
    fromTick: 10,
    toTick: 15,
    fromDate: '2026-01-01',
    toDate: '2031-01-01',
    summary: {
      deaths: [],
      pendingDeaths: [],
      ailments: [],
      recoveries: [],
      aged: 0,
    },
    deathDetails: [],
    pendingDeathDetails: [],
    ailmentDetails: [],
    recoveryDetails: [],
    aged: 0,
    ...overrides,
  };
}

describe('Simulation', () => {
  const assignMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ isStaff: true } as any);
    vi.mocked(useSimulationClock).mockReturnValue({
      data: {
        id: 'clock-1',
        currentDate: '2026-01-01',
        currentTick: 10,
        tickUnit: 'year',
        startDate: '2026-01-01',
        seasonName: 'Test Season',
        isPaused: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useAdvanceTime).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(useAdvancePreview).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useTimeAdvanceHistory).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useAssignAilment).mockReturnValue({
      mutateAsync: assignMutateAsync.mockResolvedValue({}),
      isPending: false,
    } as any);
    vi.mocked(useHealCharacter).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(useKillCharacter).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    vi.mocked(useSimEvents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useUpdateClock).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(useSearchPlayers).mockReturnValue({ data: { data: [] } } as any);
    vi.mocked(usePlayer).mockReturnValue({ data: null } as any);
  });

  it('shows recovery results in time advance previews', () => {
    vi.mocked(useAdvancePreview).mockReturnValue({
      data: basePreview({
        summary: {
          deaths: [],
          pendingDeaths: [],
          ailments: [],
          recoveries: ['player-1'],
          aged: 0,
        },
        recoveryDetails: [{
          playerId: 'player-1',
          characterName: 'Mira Sol',
          condition: 'Head Trauma',
          severity: 'major',
        }],
      }),
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<Simulation />);

    screen.getByLabelText('Preview').click();

    expect(screen.getByText('Recoveries')).toBeInTheDocument();
    expect(screen.getByText('Mira Sol')).toBeInTheDocument();
    expect(screen.getByText(/Head Trauma/)).toBeInTheDocument();
  });

  it('shows recovery counts in time advance history', () => {
    vi.mocked(useTimeAdvanceHistory).mockReturnValue({
      data: [{
        id: 'advance-1',
        fromTick: 10,
        toTick: 15,
        fromDate: '2026-01-01',
        toDate: '2031-01-01',
        advancedById: 'staff-1',
        advancedBy: { id: 'staff-1', characterName: 'Staff' },
        summary: {
          deaths: [],
          pendingDeaths: [],
          ailments: [],
          recoveries: ['player-1'],
          aged: 0,
        },
        notes: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<Simulation />);

    expect(screen.getByText('1 recovery')).toBeInTheDocument();
  });

  it('passes optional recovery duration when staff assigns an ailment from the web UI', async () => {
    const user = userEvent.setup();
    vi.mocked(useSearchPlayers).mockReturnValue({
      data: {
        data: [{
          id: 'player-1',
          characterName: 'Mira Sol',
          discordUsername: 'mira',
          isAlive: true,
        }],
      },
    } as any);
    vi.mocked(usePlayer).mockReturnValue({
      data: {
        id: 'player-1',
        characterName: 'Mira Sol',
        discordUsername: 'mira',
        isAlive: true,
        currentAge: 40,
        healthStatus: 'healthy',
        ailments: [],
      },
    } as any);

    render(<Simulation />);

    await user.type(screen.getByPlaceholderText(/Search players/), 'Mira');
    await user.click(screen.getByText('Mira Sol'));
    await user.click(screen.getByText('Assign Ailment'));
    await user.type(screen.getByLabelText('Condition'), 'Head Trauma');
    await user.type(screen.getByLabelText('Recovery duration'), '5');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(assignMutateAsync).toHaveBeenCalledWith({
      playerId: 'player-1',
      condition: 'Head Trauma',
      severity: 'minor',
      notes: undefined,
      durationYears: 5,
    });
  });
});
