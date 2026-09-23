import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BallotPanel, buildBallot } from './BallotPanel';
import { useElectionEligibility } from '../../api/hooks/useVoting';
import type { Election } from '../../api/hooks/useVoting';

const cast = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('../../api/hooks/useVoting', () => ({
  useCastBallot: () => cast,
  useElectionEligibility: vi.fn(),
}));

function election(overrides: Partial<Election> = {}): Election {
  return {
    id: 'e1',
    title: 'Second Reading',
    type: 'legislative_vote',
    method: 'yea_nay_abstain',
    config: {},
    roundNumber: 1,
    votingOpensAt: '2026-09-01T00:00:00Z',
    votingClosesAt: '2099-09-02T00:00:00Z',
    status: 'voting_open',
    createdById: 'p0',
    candidates: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildBallot', () => {
  it('matches the bot payload shapes per method', () => {
    expect(buildBallot('yea_nay_abstain', { choice: 'nay' })).toEqual({ type: 'yea_nay_abstain', choice: 'nay' });
    expect(buildBallot('fptp', { candidateId: 'p1' })).toEqual({ type: 'fptp', candidateId: 'p1' });
    expect(buildBallot('proportional', { candidateId: 'p1' })).toEqual({ type: 'fptp', candidateId: 'p1' });
    expect(buildBallot('two_round_runoff', { candidateId: 'p1' })).toEqual({ type: 'two_round', candidateId: 'p1' });
    expect(buildBallot('exhaustive_ballot', { candidateId: 'p1' })).toEqual({ type: 'exhaustive', candidateId: 'p1' });
    expect(buildBallot('stv', { ranking: ['p2', 'p1'] })).toEqual({ type: 'ranked', ranking: ['p2', 'p1'] });
    expect(buildBallot('approval', { approved: ['p1'] })).toEqual({ type: 'approval', approved: ['p1'] });
  });

  it('returns null until a choice is made', () => {
    expect(buildBallot('yea_nay_abstain', {})).toBeNull();
    expect(buildBallot('ranked_choice', { ranking: [] })).toBeNull();
    expect(buildBallot('unknown_method', { candidateId: 'p1' })).toBeNull();
  });
});

describe('BallotPanel', () => {
  beforeEach(() => {
    cast.mutateAsync.mockReset().mockResolvedValue({});
  });

  it('casts a yea ballot after confirmation', async () => {
    vi.mocked(useElectionEligibility).mockReturnValue({ data: { eligible: true }, isLoading: false } as any);
    const user = userEvent.setup();
    render(<BallotPanel election={election()} />);

    await user.click(screen.getByRole('radio', { name: /yea/i }));
    await user.click(screen.getByRole('button', { name: /^cast ballot$/i }));
    // Confirmation dialog repeats the choice before submitting.
    expect(screen.getByRole('dialog')).toHaveTextContent('YEA');
    await user.click(screen.getAllByRole('button', { name: /^cast ballot$/i }).at(-1)!);

    expect(cast.mutateAsync).toHaveBeenCalledWith({
      electionId: 'e1',
      vote: { type: 'yea_nay_abstain', choice: 'yea' },
    });
    expect(await screen.findByText(/ballot has been recorded/i)).toBeInTheDocument();
  });

  it('tells a player who already voted that their ballot is recorded', () => {
    vi.mocked(useElectionEligibility).mockReturnValue({ data: { eligible: false, reason: 'Already voted' }, isLoading: false } as any);
    render(<BallotPanel election={election()} />);
    expect(screen.getByText(/ballot has been recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cast ballot/i })).not.toBeInTheDocument();
  });

  it('points reaction-mode votes back to Discord instead of offering a web ballot', () => {
    vi.mocked(useElectionEligibility).mockReturnValue({ data: undefined, isLoading: false } as any);
    render(<BallotPanel election={election({ useReactions: true })} />);
    expect(screen.getByText(/reacting to the ballot message in Discord/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cast ballot/i })).not.toBeInTheDocument();
  });

  it('renders nothing once voting is closed', () => {
    vi.mocked(useElectionEligibility).mockReturnValue({ data: undefined, isLoading: false } as any);
    const { container } = render(<BallotPanel election={election({ status: 'tallied' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
