import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './character.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
  },
}));

function selectLimitResult(rows: unknown[], onLimit?: () => void) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(async () => {
          onLimit?.();
          return rows;
        }),
      }),
    }),
  };
}

function selectWhereResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function selectLimitOnlyResult(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function selectRejectingLimit(error: Error) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockRejectedValue(error),
      }),
    }),
  };
}

function containsText(value: unknown, pattern: RegExp, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return pattern.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (containsText(child, pattern, seen)) return true;
  }

  return false;
}

describe('/character create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acknowledges the submitted modal before checking character name uniqueness', async () => {
    const events: string[] = [];
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) {
        return selectLimitResult([{ id: 'existing-player' }], () => {
          events.push('name uniqueness check');
        });
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: 'Ada Vance',
          character_bio: 'A parliamentary comet.',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(async () => {
        events.push('defer reply');
      }),
      editReply: vi.fn(),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      options: { getSubcommand: vi.fn().mockReturnValue('create') },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    expect(events).toEqual(['defer reply', 'name uniqueness check']);
    expect(modalSubmit.reply).not.toHaveBeenCalled();
    expect(modalSubmit.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
    });
  });

  it('keeps the success response when post-commit Discord role metadata lookup fails', async () => {
    const roleLookupError = new Error('role lookup failed after character commit');
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) return selectLimitResult([]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([]);
      if (selectCall === 5) return selectWhereResult([]);
      if (selectCall === 6) return selectLimitResult([]);
      if (selectCall === 7) return selectLimitResult([]);
      if (selectCall === 8) return selectLimitOnlyResult([]);
      if (selectCall === 9) return selectRejectingLimit(roleLookupError);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    let txInsertCall = 0;
    const tx = {
      insert: vi.fn(() => {
        txInsertCall += 1;
        if (txInsertCall === 1) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'player-1' }]),
            }),
          };
        }
        return {
          values: vi.fn().mockResolvedValue(undefined),
        };
      }),
    };
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx));

    let endHandler: (() => void) | undefined;
    const portraitCollector = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'end') {
          endHandler = handler;
          queueMicrotask(() => endHandler?.());
        }
        return portraitCollector;
      }),
      stop: vi.fn(),
    };
    const portraitMsg = {
      createMessageComponentCollector: vi.fn(() => portraitCollector),
      awaitMessageComponent: vi
        .fn()
        .mockResolvedValueOnce({ values: ['faction-1'], deferUpdate: vi.fn() })
        .mockResolvedValueOnce({ customId: 'char_confirm_discord-user-1', deferUpdate: vi.fn() }),
    };

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: 'Ada Vance',
          character_bio: 'A parliamentary comet.',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(),
      editReply: vi.fn().mockResolvedValue(portraitMsg),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      guild: {
        members: {
          cache: { get: vi.fn(() => ({ roles: { add: vi.fn() } })) },
          fetch: vi.fn(),
        },
      },
      options: { getSubcommand: vi.fn().mockReturnValue('create') },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /Character Created!/))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Failed to create character/))).toBe(false);
  });

  it('does not overwrite an existing character if a concurrent create finishes first', async () => {
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) return selectLimitResult([]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([]);
      if (selectCall === 5) return selectWhereResult([]);
      if (selectCall === 6) return selectLimitResult([]);
      if (selectCall === 7) return selectLimitResult([{ id: 'player-1' }]);
      if (selectCall === 8) return selectLimitOnlyResult([]);
      if (selectCall === 9) return selectLimitResult([]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const tx = {
      update: vi.fn(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    };
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx));

    let endHandler: (() => void) | undefined;
    const portraitCollector = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'end') {
          endHandler = handler;
          queueMicrotask(() => endHandler?.());
        }
        return portraitCollector;
      }),
      stop: vi.fn(),
    };
    const portraitMsg = {
      createMessageComponentCollector: vi.fn(() => portraitCollector),
      awaitMessageComponent: vi
        .fn()
        .mockResolvedValueOnce({ values: ['faction-1'], deferUpdate: vi.fn() })
        .mockResolvedValueOnce({ customId: 'char_confirm_discord-user-1', deferUpdate: vi.fn() }),
    };

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: 'Ada Vance',
          character_bio: 'A parliamentary comet.',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(),
      editReply: vi.fn().mockResolvedValue(portraitMsg),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      guild: null,
      options: { getSubcommand: vi.fn().mockReturnValue('create') },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /already has a character/i))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Character Created!/))).toBe(false);
  });
});
