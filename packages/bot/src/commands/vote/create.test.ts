import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  hasPermission: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  ilike: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })),
}));

vi.mock('@hansard/db', () => ({
  elections: {
    id: 'elections.id',
  },
  players: {
    id: 'players.id',
    discordId: 'players.discordId',
  },
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

import { handleVoteCreateModal } from './create';

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeModalInteraction(overrides: Record<string, unknown> = {}) {
  const values: Record<string, string> = {
    title: 'Bridge Security Act',
    description: 'Establishes protections and patrol authority.',
    duration: '24',
  };

  return {
    customId: 'vote-create:referendum:yea_nay_abstain:simple:reactions',
    user: { id: 'discord-user-1' },
    fields: {
      getTextInputValue: vi.fn((key: string) => values[key] ?? ''),
    },
    deferReply: vi.fn(async () => {
      mocks.calls.push('deferReply');
    }),
    editReply: vi.fn(async () => {
      mocks.calls.push('editReply');
    }),
    reply: vi.fn(async () => {
      mocks.calls.push('reply');
    }),
    ...overrides,
  };
}

describe('handleVoteCreateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.db.select.mockImplementation(() => {
      mocks.calls.push('db.select');
      return selectLimit([]);
    });
  });

  it('acknowledges the modal before player lookup work', async () => {
    const interaction = makeModalInteraction();

    await handleVoteCreateModal(interaction as any);

    expect(mocks.calls[0]).toBe('deferReply');
    expect(mocks.calls).toContain('db.select');
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
