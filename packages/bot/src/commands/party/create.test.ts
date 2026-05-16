import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
  },
  isStaff: vi.fn(),
  refreshPartyJoinMessage: vi.fn(),
  insertedValues: null as Record<string, unknown> | null,
  returnedParty: {
    id: 'party-new',
    name: 'New Horizon',
    shortName: 'NH',
    ideology: 'Civic futurism',
    colour: '#1751d8',
    discordRoleId: 'role-new',
    isInviteOnly: false,
  },
}));

vi.mock('@hansard/db', () => ({
  parties: {
    id: 'parties.id',
  },
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('../../utils/partyJoinMessage.js', () => ({
  refreshPartyJoinMessage: mocks.refreshPartyJoinMessage,
}));

import { execute as createPartyExecute } from './create';

class InsertQuery {
  values(values: Record<string, unknown>) {
    mocks.insertedValues = values;
    return this;
  }

  returning() {
    return Promise.resolve([mocks.returnedParty]);
  }
}

function fakeInteraction(overrides: Record<string, unknown> = {}) {
  const strings: Record<string, string | null> = {
    name: 'New Horizon',
    'short-name': 'NH',
    ideology: 'Civic futurism',
    colour: '#1751d8',
    'faction-id': null,
  };

  return {
    client: { user: { id: 'bot-user' } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    options: {
      getString: vi.fn((name: string) => strings[name] ?? null),
      getRole: vi.fn(() => ({ id: 'role-new' })),
      getBoolean: vi.fn(() => false),
    },
    ...overrides,
  } as any;
}

describe('/party create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedValues = null;
    mocks.isStaff.mockResolvedValue(true);
    mocks.refreshPartyJoinMessage.mockResolvedValue({ id: 'join-board' });
    mocks.db.insert.mockReturnValue(new InsertQuery());
  });

  it('refreshes the public party join board after creating an open party', async () => {
    const interaction = fakeInteraction();

    await createPartyExecute(interaction);

    expect(mocks.insertedValues).toMatchObject({
      name: 'New Horizon',
      shortName: 'NH',
      ideology: 'Civic futurism',
      colour: '#1751d8',
      discordRoleId: 'role-new',
      isInviteOnly: false,
      isActive: true,
    });
    expect(mocks.refreshPartyJoinMessage).toHaveBeenCalledWith(interaction.client);
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds: expect.any(Array) });
  });

  it('keeps party creation successful when the join board cannot be refreshed', async () => {
    const interaction = fakeInteraction();
    mocks.refreshPartyJoinMessage.mockRejectedValueOnce(new Error('missing channel'));

    await createPartyExecute(interaction);

    expect(mocks.refreshPartyJoinMessage).toHaveBeenCalledWith(interaction.client);
    const replyPayload = interaction.editReply.mock.calls[0]?.[0];
    expect(replyPayload.embeds[0].data.description).toContain('Party join board refresh failed');
  });
});
