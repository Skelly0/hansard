import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectionStatus, ElectionType } from '@hansard/shared';

const mocks = vi.hoisted(() => ({
  db: {},
  findElectionByReference: vi.fn(),
  hasPermission: vi.fn(),
  cancelVote: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('./_electionReference.js', () => ({
  findElectionByReference: mocks.findElectionByReference,
}));

vi.mock('./cancelFlow.js', () => ({
  cancelVote: mocks.cancelVote,
}));

import command from './cancel.js';

const openElection = {
  id: 'election-1',
  title: 'Vote on: Transit Reform Act',
  type: ElectionType.LEGISLATIVE_VOTE,
  status: ElectionStatus.VOTING_OPEN,
  relatedBillId: 'bill-1',
};

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    user: { id: 'discord-1' },
    options: {
      getString: vi.fn((name: string, required?: boolean) => {
        if (name === 'election' && required) return 'Vote on: Transit Reform Act';
        if (name === 'reason') return 'Wrong threshold';
        return null;
      }),
    },
    channel: null,
    ...overrides,
  };
}

describe('/vote-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.findElectionByReference.mockResolvedValue({
      election: openElection,
      errorMessage: null,
      reference: { kind: 'title', value: openElection.title },
    });
    mocks.cancelVote.mockResolvedValue({
      election: { ...openElection, status: ElectionStatus.CANCELLED },
      bill: {
        id: 'bill-1',
        title: 'Transit Reform Act',
        billNumber: 1,
        status: 'submitted',
        playerVoteId: null,
      },
      previousElectionStatus: ElectionStatus.VOTING_OPEN,
    });
  });

  it('allows legislative leaders to cancel a linked legislative vote', async () => {
    const interaction = makeInteraction();

    await command.execute(interaction as any);

    expect(mocks.hasPermission).toHaveBeenCalledWith(interaction.member, 'voting.cancel');
    expect(mocks.cancelVote).toHaveBeenCalledWith(mocks.db, openElection, {
      actorDiscordId: 'discord-1',
      reason: 'Wrong threshold',
    });
    const replyEmbed = interaction.editReply.mock.calls[0]?.[0]?.embeds?.[0];
    expect(replyEmbed?.data.title).toContain('Vote Cancelled');
    expect(replyEmbed?.data.description).toContain('Bill #`B-001` has been returned to `submitted`.');
  });

  it('rejects users without cancel permission', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const interaction = makeInteraction();

    await command.execute(interaction as any);

    expect(mocks.cancelVote).not.toHaveBeenCalled();
    const replyEmbed = interaction.editReply.mock.calls[0]?.[0]?.embeds?.[0];
    expect(replyEmbed?.data.description).toContain('Only the Chancellor or staff can cancel elections.');
  });
});
