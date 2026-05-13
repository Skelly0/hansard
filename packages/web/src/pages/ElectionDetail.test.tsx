import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ElectionDetail } from './ElectionDetail';
import {
  useElection,
  useElectionResults,
  useElectionRounds,
  useElectionTurnout,
} from '../api/hooks/useVoting';
import { useAuth } from '../api/hooks/useAuth';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'election-1' }),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../api/hooks/useVoting', () => ({
  useElection: vi.fn(),
  useElectionResults: vi.fn(),
  useElectionRounds: vi.fn(),
  useElectionTurnout: vi.fn(),
  useOpenVoting: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloseVoting: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTallyVotes: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCertifyElection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateRunoff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNpcConfirm: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWithdrawCandidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegisterCandidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  hasTalliedResults: (res: any): boolean =>
    !!res && 'finalTallies' in res && res.finalTallies !== undefined,
  isSealedOpenResults: (res: any): boolean => !!res && res.sealed === true,
}));

vi.mock('../api/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/hooks/usePlayers', () => ({
  useSearchPlayers: () => ({ data: { data: [] } }),
}));

vi.mock('../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (v: unknown) => v,
}));

describe('ElectionDetail', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isStaff: false,
      permissions: [],
      hasPermission: () => false,
      logout: vi.fn(),
      isLoading: false,
    } as any);
    vi.mocked(useElectionRounds).mockReturnValue({ data: undefined } as any);
    vi.mocked(useElectionTurnout).mockReturnValue({ data: undefined } as any);
  });

  it('renders a "Results sealed until close" notice for sealed open elections without crashing', () => {
    vi.mocked(useElection).mockReturnValue({
      data: {
        id: 'election-1',
        title: 'Test Sealed Vote',
        description: 'A sealed in-progress vote.',
        type: 'legislative_vote',
        method: 'yea_nay_abstain',
        config: { sealedResults: true },
        roundNumber: 1,
        votingOpensAt: '2026-05-01T00:00:00.000Z',
        votingClosesAt: '2026-05-08T00:00:00.000Z',
        status: 'voting_open',
        createdById: 'player-1',
        candidates: [],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
    } as any);

    // This is the actual shape the API returns for a sealed-open election:
    // { sealed: true, status: 'voting_open', results: null }
    vi.mocked(useElectionResults).mockReturnValue({
      data: { sealed: true, status: 'voting_open', results: null },
      isLoading: false,
      isError: false,
    } as any);

    // Render must NOT crash on Math.max(...Object.values(finalTallies)).
    expect(() => render(<ElectionDetail />)).not.toThrow();

    // The user should see a clear "sealed until close" callout.
    expect(screen.getByText(/sealed until close/i)).toBeInTheDocument();

    // And no "Margin:" / finalTallies-derived bars should be rendered.
    expect(screen.queryByText(/Margin:/i)).not.toBeInTheDocument();
  });

  it('does not crash for unsealed-pending shape ({ sealed: false, results: null })', () => {
    vi.mocked(useElection).mockReturnValue({
      data: {
        id: 'election-1',
        title: 'Pending Tally',
        type: 'legislative_vote',
        method: 'yea_nay_abstain',
        config: {},
        roundNumber: 1,
        votingOpensAt: '2026-05-01T00:00:00.000Z',
        votingClosesAt: '2026-05-08T00:00:00.000Z',
        status: 'voting_closed',
        createdById: 'player-1',
        candidates: [],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
    } as any);

    vi.mocked(useElectionResults).mockReturnValue({
      data: { sealed: false, status: 'voting_closed', results: null },
      isLoading: false,
      isError: false,
    } as any);

    expect(() => render(<ElectionDetail />)).not.toThrow();
    // No tally bars yet.
    expect(screen.queryByText(/Margin:/i)).not.toBeInTheDocument();
  });

  it('renders final tallies for a fully-tallied election', () => {
    vi.mocked(useElection).mockReturnValue({
      data: {
        id: 'election-1',
        title: 'Tallied Vote',
        type: 'legislative_vote',
        method: 'yea_nay_abstain',
        config: {},
        roundNumber: 1,
        votingOpensAt: '2026-05-01T00:00:00.000Z',
        votingClosesAt: '2026-05-08T00:00:00.000Z',
        status: 'tallied',
        createdById: 'player-1',
        candidates: [],
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
    } as any);

    vi.mocked(useElectionResults).mockReturnValue({
      data: {
        sealed: false,
        status: 'tallied',
        totalVotes: 10,
        turnout: 1,
        finalTallies: { yea: 7, nay: 3, abstain: 0 },
        passed: true,
      },
      isLoading: false,
      isError: false,
    } as any);

    expect(() => render(<ElectionDetail />)).not.toThrow();
    expect(screen.getByText(/Margin:/i)).toBeInTheDocument();
  });
});
