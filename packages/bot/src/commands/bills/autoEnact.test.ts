import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillStatus, ElectionType } from '@hansard/shared';

const mocks = vi.hoisted(() => ({
  enactBill: vi.fn(),
  postLegislationEmbed: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  bills: {
    id: 'bills.id',
    title: 'bills.title',
    billNumber: 'bills.billNumber',
    status: 'bills.status',
    authorId: 'bills.authorId',
    summary: 'bills.summary',
    googleDocUrl: 'bills.googleDocUrl',
    tags: 'bills.tags',
    policyAreas: 'bills.policyAreas',
    legislationChannelId: 'bills.legislationChannelId',
    legislationMessageId: 'bills.legislationMessageId',
    updatedAt: 'bills.updatedAt',
  },
  players: {
    id: 'players.id',
    characterName: 'players.characterName',
    discordId: 'players.discordId',
  },
}));

vi.mock('./enactFlow.js', () => ({
  enactBill: mocks.enactBill,
}));

vi.mock('../../utils/legislationChannel.js', () => ({
  postLegislationEmbed: mocks.postLegislationEmbed,
}));

import { autoEnactPassedBillFromElection } from './autoEnact.js';

const now = new Date('2026-05-17T20:00:00.000Z');

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function updateSet(captured: unknown[]) {
  return {
    set: vi.fn((value) => {
      captured.push(value);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
}

describe('autoEnactPassedBillFromElection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enacts a player-passed linked bill, posts the legislation embed, and stores the message id', async () => {
    const bill = {
      id: 'bill-1',
      title: 'Bridge Security Act',
      billNumber: 12,
      status: BillStatus.PLAYER_PASSED,
      authorId: 'author-1',
      summary: 'Keeps the bridge standing.',
      googleDocUrl: 'https://docs.example/bill',
      tags: ['security'],
      policyAreas: ['infrastructure'],
    };
    const author = { characterName: 'Ada Vance', discordId: 'author-discord' };
    const actor = { discordId: 'creator-discord' };
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(selectLimit([bill]))
        .mockReturnValueOnce(selectLimit([author]))
        .mockReturnValueOnce(selectLimit([actor])),
      update: vi.fn(),
    };
    const client = { channels: { fetch: vi.fn() } };
    mocks.enactBill.mockResolvedValue({ bill: { ...bill, status: BillStatus.ENACTED }, previousStatus: BillStatus.PLAYER_PASSED });
    mocks.postLegislationEmbed.mockResolvedValue({ status: 'sent', channelId: 'law-channel', messageId: 'law-message' });

    const result = await autoEnactPassedBillFromElection({
      database: db as any,
      client: client as any,
      election: {
        id: 'election-1',
        type: ElectionType.LEGISLATIVE_VOTE,
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
      },
      now,
    });

    expect(result).toMatchObject({ status: 'enacted', billId: 'bill-1' });
    expect(mocks.enactBill).toHaveBeenCalledWith(db, expect.objectContaining({
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      changedById: 'creator-player',
      actorDiscordId: 'creator-discord',
      legislationChannelId: 'law-channel',
      legislationMessageId: 'law-message',
      now,
    }));
    expect(mocks.postLegislationEmbed.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.enactBill.mock.invocationCallOrder[0]);
    expect(mocks.postLegislationEmbed).toHaveBeenCalledWith(expect.objectContaining({
      client,
    }));
    const embed = mocks.postLegislationEmbed.mock.calls[0]?.[0]?.embed;
    expect(embed.data.description).toContain('**Bill #B-012** has been enacted and is now law.');
    expect(embed.data.description).toContain('Enacted automatically after player-house passage');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not mark the bill enacted when the legislation post fails', async () => {
    const bill = {
      id: 'bill-1',
      title: 'Bridge Security Act',
      billNumber: 12,
      status: BillStatus.PLAYER_PASSED,
      authorId: 'author-1',
      summary: null,
      googleDocUrl: null,
      tags: [],
      policyAreas: [],
    };
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(selectLimit([bill]))
        .mockReturnValueOnce(selectLimit([{ characterName: 'Ada Vance', discordId: null }]))
        .mockReturnValueOnce(selectLimit([{ discordId: 'creator-discord' }])),
      update: vi.fn(),
    };
    mocks.postLegislationEmbed.mockResolvedValue({ status: 'failed', channelId: 'law-channel' });

    await expect(autoEnactPassedBillFromElection({
      database: db as any,
      client: { channels: { fetch: vi.fn() } } as any,
      election: {
        id: 'election-1',
        type: ElectionType.LEGISLATIVE_VOTE,
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
      },
      now,
    })).rejects.toThrow(/failed to post legislation message/i);

    expect(mocks.enactBill).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('repairs an already-enacted linked bill that is missing its legislation post', async () => {
    const updateValues: unknown[] = [];
    const enactedAt = new Date('2026-05-17T19:13:36.198Z');
    const bill = {
      id: 'bill-1',
      title: 'Industrial Peace Ordinance',
      billNumber: 37,
      status: BillStatus.ENACTED,
      authorId: 'author-1',
      summary: null,
      googleDocUrl: null,
      tags: [],
      policyAreas: [],
      enactedAt,
      legislationChannelId: null,
      legislationMessageId: null,
    };
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(selectLimit([bill]))
        .mockReturnValueOnce(selectLimit([{ characterName: 'Ada Vance', discordId: 'author-discord' }]))
        .mockReturnValueOnce(selectLimit([{ discordId: 'creator-discord' }])),
      update: vi.fn(() => updateSet(updateValues)),
    };
    mocks.postLegislationEmbed.mockResolvedValue({ status: 'sent', channelId: 'law-channel', messageId: 'law-message' });

    const result = await autoEnactPassedBillFromElection({
      database: db as any,
      client: { channels: { fetch: vi.fn() } } as any,
      election: {
        id: 'election-1',
        type: ElectionType.LEGISLATIVE_VOTE,
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
      },
      now,
    });

    expect(result).toMatchObject({ status: 'repaired', billId: 'bill-1' });
    expect(mocks.enactBill).not.toHaveBeenCalled();
    const embed = mocks.postLegislationEmbed.mock.calls[0]?.[0]?.embed;
    expect(embed.data.description).toContain('Enacted automatically after player-house passage');
    expect(embed.data.description).toContain(`<t:${Math.floor(enactedAt.getTime() / 1000)}:F>`);
    expect(updateValues[0]).toMatchObject({
      legislationChannelId: 'law-channel',
      legislationMessageId: 'law-message',
    });
  });

  it('skips elections without a linked legislative bill', async () => {
    const db = { select: vi.fn(), update: vi.fn() };

    const result = await autoEnactPassedBillFromElection({
      database: db as any,
      client: { channels: { fetch: vi.fn() } } as any,
      election: {
        id: 'election-1',
        type: ElectionType.REFERENDUM,
        relatedBillId: null,
        createdById: 'creator-player',
      },
      now,
    });

    expect(result).toMatchObject({ status: 'skipped', reason: 'not_linked_legislative_vote' });
    expect(db.select).not.toHaveBeenCalled();
    expect(mocks.enactBill).not.toHaveBeenCalled();
  });

  it('skips linked bills that are not player-passed', async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce(selectLimit([{
        id: 'bill-1',
        status: BillStatus.NPC_PENDING,
      }])),
      update: vi.fn(),
    };

    const result = await autoEnactPassedBillFromElection({
      database: db as any,
      client: { channels: { fetch: vi.fn() } } as any,
      election: {
        id: 'election-1',
        type: ElectionType.LEGISLATIVE_VOTE,
        relatedBillId: 'bill-1',
        createdById: 'creator-player',
      },
      now,
    });

    expect(result).toMatchObject({ status: 'skipped', reason: 'bill_status_npc_pending', billId: 'bill-1' });
    expect(mocks.enactBill).not.toHaveBeenCalled();
    expect(mocks.postLegislationEmbed).not.toHaveBeenCalled();
  });
});
