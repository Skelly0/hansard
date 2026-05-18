import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  hasPermission: vi.fn(),
  enactAndPostBill: vi.fn(),
  postExistingEnactedBill: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  ilike: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@hansard/db', () => ({
  bills: {
    id: 'bills.id',
    billNumber: 'bills.billNumber',
    title: 'bills.title',
    status: 'bills.status',
    authorId: 'bills.authorId',
  },
  players: {
    id: 'players.id',
    characterName: 'players.characterName',
    discordId: 'players.discordId',
  },
}));

vi.mock('./autoEnact.js', () => ({
  enactAndPostBill: mocks.enactAndPostBill,
  postExistingEnactedBill: mocks.postExistingEnactedBill,
  LegislationPostError: class LegislationPostError extends Error {},
}));

import { execute } from './enact.js';

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    client: { channels: { fetch: vi.fn() } },
    guild: {
      members: {
        cache: new Map([['actor-discord', { roles: { cache: new Map() } }]]),
      },
    },
    user: { id: 'actor-discord' },
    options: {
      getString: vi.fn(() => 'B-037'),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/bill enact repair path', () => {
  beforeEach(() => {
    mocks.db.select.mockReset();
    mocks.hasPermission.mockReset();
    mocks.enactAndPostBill.mockReset();
    mocks.postExistingEnactedBill.mockReset();
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('enacts a submitted bill without requiring a prior house vote', async () => {
    const bill = {
      id: 'bill-37',
      billNumber: 37,
      title: 'Industrial Peace Ordinance',
      status: BillStatus.SUBMITTED,
      authorId: 'author-1',
    };
    const embed = { data: { title: bill.title } };
    mocks.db.select
      .mockReturnValueOnce(selectLimit([bill]))
      .mockReturnValueOnce(selectLimit([{ id: 'actor-player' }]))
      .mockReturnValueOnce(selectLimit([{ characterName: 'Ada Vance', discordId: 'author-discord' }]));
    mocks.enactAndPostBill.mockResolvedValue({
      embed,
      postResult: { status: 'sent', channelId: 'law-channel', messageId: 'law-message' },
    });

    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.enactAndPostBill).toHaveBeenCalledWith(expect.objectContaining({
      bill,
      authorDisplay: 'Ada Vance (<@author-discord>)',
      changedById: 'actor-player',
      actorDiscordId: 'actor-discord',
    }));
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('repairs an enacted bill that is missing its legislation message', async () => {
    const enactedAt = new Date('2026-05-17T19:13:36.198Z');
    const bill = {
      id: 'bill-37',
      billNumber: 37,
      title: 'Industrial Peace Ordinance',
      status: BillStatus.ENACTED,
      authorId: 'author-1',
      enactedAt,
      legislationChannelId: null,
      legislationMessageId: null,
    };
    const embed = { data: { title: bill.title } };
    mocks.db.select
      .mockReturnValueOnce(selectLimit([bill]))
      .mockReturnValueOnce(selectLimit([{ characterName: 'Ada Vance', discordId: 'author-discord' }]));
    mocks.postExistingEnactedBill.mockResolvedValue({
      embed,
      postResult: { status: 'sent', channelId: 'law-channel', messageId: 'law-message' },
    });

    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.postExistingEnactedBill).toHaveBeenCalledWith(expect.objectContaining({
      bill,
      authorDisplay: 'Ada Vance (<@author-discord>)',
      now: enactedAt,
    }));
    expect(mocks.enactAndPostBill).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('still refuses an enacted bill that already has a stored legislation message', async () => {
    mocks.db.select.mockReturnValueOnce(selectLimit([{
      id: 'bill-37',
      billNumber: 37,
      title: 'Industrial Peace Ordinance',
      status: BillStatus.ENACTED,
      authorId: 'author-1',
      legislationChannelId: 'law-channel',
      legislationMessageId: 'law-message',
    }]));

    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.postExistingEnactedBill).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });
});
