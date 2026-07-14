import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './character.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  registerAwaitingInteraction: vi.fn(),
  unregisterAwaitingInteraction: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
    update: mocks.update,
    insert: mocks.insert,
  },
}));

vi.mock('../../utils/awaitingInteractions.js', () => ({
  registerAwaitingInteraction: mocks.registerAwaitingInteraction,
  unregisterAwaitingInteraction: mocks.unregisterAwaitingInteraction,
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

function selectInnerJoinWhereResult(
  rows: unknown[],
  onWhere?: (whereArg: unknown) => unknown[] | Promise<unknown[]>,
) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((whereArg: unknown) =>
          Promise.resolve(onWhere ? onWhere(whereArg) : rows),
        ),
      }),
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
    if (key === 'timestamp') continue;
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (containsText(child, pattern, seen)) return true;
  }

  return false;
}

describe('/character create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps direct-upload portrait messages because the portrait URL depends on the source attachment', async () => {
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) return selectLimitResult([]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([]);
      if (selectCall === 5) return selectWhereResult([]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const uploadedMsg = {
      author: { id: 'discord-user-1' },
      attachments: {
        first: vi.fn(() => ({
          contentType: 'image/png',
          url: 'https://cdn.discordapp.com/attachments/111/222/Portrait_(1).png?ex=65d903de&is=65c68ede&hm=abc123&',
        })),
      },
      content: '',
      delete: vi.fn(),
    };

    const messageCollector = {
      on: vi.fn((event: string, handler: (msg: typeof uploadedMsg) => void) => {
        if (event === 'collect') {
          queueMicrotask(() => handler(uploadedMsg));
        }
        return messageCollector;
      }),
      stop: vi.fn(),
    };

    const buttonCollector = {
      on: vi.fn(() => buttonCollector),
      stop: vi.fn(),
    };

    const portraitMsg = {
      createMessageComponentCollector: vi.fn(() => buttonCollector),
      awaitMessageComponent: vi
        .fn()
        .mockResolvedValueOnce({ values: ['faction-1'], deferUpdate: vi.fn() })
        .mockResolvedValueOnce({
          customId: 'char_cancel_discord-user-1',
          update: vi.fn(),
        }),
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
      channel: {
        createMessageCollector: vi.fn(() => messageCollector),
      },
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const confirmPayload = modalSubmit.editReply.mock.calls
      .map(([payload]) => payload)
      .find((payload) => containsText(payload, /Character Summary/));

    expect(uploadedMsg.delete).not.toHaveBeenCalled();
    expect(containsText(confirmPayload, /\[View Image\]\(https:\/\/cdn\.discordapp\.com\/attachments\/111\/222\/Portrait_%281%29\.png\?ex=65d903de&is=65c68ede&hm=abc123&\)/)).toBe(true);
  });

  it('stores source attachment metadata for direct-upload portraits', async () => {
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
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const attachmentUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Portrait_(1).png?ex=65d903de&is=65c68ede&hm=abc123&';
    const storedAttachmentUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Portrait_%281%29.png?ex=65d903de&is=65c68ede&hm=abc123&';
    const uploadedMsg = {
      id: 'message-1',
      channelId: 'channel-1',
      author: { id: 'discord-user-1' },
      attachments: {
        first: vi.fn(() => ({
          id: 'attachment-1',
          name: 'Portrait_(1).png',
          contentType: 'image/png',
          url: attachmentUrl,
        })),
      },
      content: '',
      delete: vi.fn(),
    };

    const messageCollector = {
      on: vi.fn((event: string, handler: (msg: typeof uploadedMsg) => void) => {
        if (event === 'collect') {
          queueMicrotask(() => handler(uploadedMsg));
        }
        return messageCollector;
      }),
      stop: vi.fn(),
    };

    const buttonCollector = {
      on: vi.fn(() => buttonCollector),
      stop: vi.fn(),
    };

    const portraitMsg = {
      createMessageComponentCollector: vi.fn(() => buttonCollector),
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

    const playerValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'player-1' }]),
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce({ values: playerValues })
        .mockReturnValueOnce({ values: eventValues }),
    };
    mocks.transaction.mockImplementation(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx));

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      guild: null,
      channel: {
        createMessageCollector: vi.fn(() => messageCollector),
      },
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    expect(playerValues).toHaveBeenCalledWith(expect.objectContaining({
      characterPortraitUrl: storedAttachmentUrl,
      profileData: {
        characterPortraitAttachment: {
          channelId: 'channel-1',
          messageId: 'message-1',
          attachmentId: 'attachment-1',
          filename: 'Portrait_(1).png',
        },
      },
    }));
    expect(uploadedMsg.delete).not.toHaveBeenCalled();
  });

  it('accepts character names with straight quotes (the case the user reported)', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) return selectLimitResult([]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([]);
      if (selectCall === 5) return selectWhereResult([]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

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
        .mockResolvedValueOnce({
          customId: 'char_cancel_discord-user-1',
          update: vi.fn(),
        }),
    };

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: 'Edmund "The Cruel" Blackwood',
          character_bio: '',
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    // Should NOT have errored on the quotes — should reach the confirmation step
    // (and only stop there because we wire the test to cancel).
    expect(editPayloads.some((payload) => containsText(payload, /cannot contain|invisible|Invalid character name/i))).toBe(false);
    expect(editPayloads.some((payload) => containsText(payload, /Character Summary/))).toBe(true);
    // Quotes survive the round-trip unchanged.
    expect(editPayloads.some((payload) => containsText(payload, /Edmund "The Cruel" Blackwood/))).toBe(true);
  });

  it('rejects character names containing @ with a specific error before any DB call', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      throw new Error(`Unexpected select call ${selectCall} (validation should reject before name uniqueness check)`);
    });

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: '@everyone is alerted',
          character_bio: '',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /cannot contain/i))).toBe(true);
    // No "database error" fallback — error should be the validation message.
    expect(editPayloads.some((payload) => containsText(payload, /database error/i))).toBe(false);
  });

  it('rejects empty character names with a specific error', async () => {
    mocks.select.mockImplementation(() => selectLimitResult([]));

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: '   ',
          character_bio: '',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /empty/i))).toBe(true);
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /Character Created!/))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Failed to create character/))).toBe(false);
  });

  it('does not offer invite-only parties during self-service character creation', async () => {
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) return selectLimitResult([]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([
        { id: 'party-open', name: 'Open League', shortName: 'OPEN', isInviteOnly: false },
        { id: 'party-private', name: 'Private Caucus', shortName: 'PRV', isInviteOnly: true },
      ]);
      if (selectCall === 5) return selectWhereResult([
        { id: 'party-open', name: 'Open League', shortName: 'OPEN', isInviteOnly: false },
        { id: 'party-private', name: 'Private Caucus', shortName: 'PRV', isInviteOnly: true },
      ]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

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
        .mockResolvedValueOnce({ values: ['none'], deferUpdate: vi.fn() })
        .mockResolvedValueOnce({
          customId: 'char_cancel_discord-user-1',
          update: vi.fn(),
        }),
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const partyPayload = modalSubmit.editReply.mock.calls
      .map(([payload]) => payload)
      .find((payload) => containsText(payload, /Choose Your Party/));

    expect(partyPayload).toBeDefined();
    expect(containsText(partyPayload, /Open League/)).toBe(true);
    expect(containsText(partyPayload, /Private Caucus/)).toBe(false);
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /already has a character/i))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Character Created!/))).toBe(false);
  });

  it('lets a player register a successor after their previous character died', async () => {
    const oldCharacter = {
      id: 'player-1',
      discordId: 'discord-user-1',
      discordUsername: 'ada',
      characterName: 'Ada Mortalis',
      characterBio: 'The old guard.',
      characterPortraitUrl: null,
      factionId: 'faction-old',
      partyId: 'party-old',
      birthDate: '1840-01-01',
      startingAge: 60,
      currentAge: 80,
      deathDate: '1920-01-01',
      causeOfDeath: 'natural causes',
      isAlive: false,
      healthStatus: 'deceased',
      ailments: [],
      startingFavoursGranted: true,
      isActive: true,
      isStaff: false,
      staffRole: null,
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      lastActiveAt: null,
      profileData: { pronouns: 'she/her' },
    };
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return selectLimitResult([{
          id: oldCharacter.id,
          characterName: oldCharacter.characterName,
          isAlive: oldCharacter.isAlive,
        }]);
      }
      if (selectCall === 2) return selectLimitResult([{ id: oldCharacter.id, discordId: oldCharacter.discordId }]);
      if (selectCall === 3) return selectWhereResult([{ id: 'faction-1', name: 'Commons', shortName: 'COM' }]);
      if (selectCall === 4) return selectWhereResult([]);
      if (selectCall === 5) return selectWhereResult([]);
      if (selectCall === 6) return selectLimitResult([{ id: oldCharacter.id, discordId: oldCharacter.discordId }]);
      if (selectCall === 7) return selectLimitResult([oldCharacter]);
      if (selectCall === 8) return selectLimitOnlyResult([{ currentDate: '1930-01-01' }]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'old-balance',
            playerId: oldCharacter.id,
            categoryId: 'category-old',
            balance: 5,
          }]),
        }),
      })),
      delete: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
      update: vi.fn(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: oldCharacter.id }]),
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
          character_name: 'Beatrice Vance',
          character_bio: 'A new claimant.',
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    expect(interaction.showModal).toHaveBeenCalled();
    const updateSet = tx.update.mock.results[0]?.value.set;
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      characterName: 'Beatrice Vance',
      isAlive: true,
      healthStatus: 'healthy',
      deathDate: null,
      causeOfDeath: null,
    }));
    expect(updateSet.mock.calls[0][0].profileData.previousCharacters[0]).toMatchObject({
      characterName: 'Ada Mortalis',
      deathDate: '1920-01-01',
      healthStatus: 'deceased',
    });
    expect(tx.delete).toHaveBeenCalledTimes(1);

    const editPayloads = modalSubmit.editReply.mock.calls.map(([payload]) => payload);
    expect(editPayloads.some((payload) => containsText(payload, /Successor Character Registered/))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Beatrice Vance/))).toBe(true);
    expect(editPayloads.some((payload) => containsText(payload, /Ada Mortalis/))).toBe(true);
  });

  it('registers every awaited customId for stale-token recovery and uses 14-minute awaiter windows', async () => {
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
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const playerValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'player-1' }]),
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce({ values: playerValues })
        .mockReturnValueOnce({ values: eventValues }),
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
      options: { getSubcommand: vi.fn().mockReturnValue('create'), getSubcommandGroup: vi.fn().mockReturnValue(null) },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    // The 5-minute modal window silently dropped submissions from players
    // still writing their bio; the awaiter must use the 14-minute window
    // that matches Discord's interaction-token lifetime.
    expect(interaction.awaitModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ time: 840_000 }),
    );
    for (const call of portraitMsg.awaitMessageComponent.mock.calls) {
      expect(call[0]).toMatchObject({ time: 840_000 });
    }

    const registered = mocks.registerAwaitingInteraction.mock.calls.map((c) => c[0] as string);
    const unregistered = mocks.unregisterAwaitingInteraction.mock.calls.map((c) => c[0] as string);

    for (const expectedId of [
      'char_create_discord-user-1',
      'portrait_skip_discord-user-1',
      'faction_sel_discord-user-1',
      'char_confirm_discord-user-1',
      'char_cancel_discord-user-1',
    ]) {
      expect(registered).toContain(expectedId);
    }
    for (const id of registered) {
      expect(unregistered).toContain(id);
    }
  });
});

describe('/character view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows only current offices after a deceased character is replaced by a successor', async () => {
    let selectCall = 0;
    const officeRows = [
      { officeName: 'Former Chancellor', officeTier: 'cabinet' },
      { officeName: 'Current Delegate', officeTier: 'legislature' },
    ];

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return selectLimitResult([{
          id: 'player-1',
          characterName: 'Beatrice Vance',
          characterBio: 'A fresh claimant to the bench.',
          characterPortraitUrl: null,
          currentAge: 28,
          startingAge: 28,
          factionId: null,
          partyId: null,
          healthStatus: 'healthy',
          ailments: [],
          isAlive: true,
          causeOfDeath: null,
        }]);
      }
      if (selectCall === 2) {
        return selectInnerJoinWhereResult(officeRows, (whereArg) =>
          containsText(whereArg, /is null/i)
            ? [officeRows[1]]
            : officeRows,
        );
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const interaction = {
      user: { id: 'discord-user-1', displayName: 'Beatrice' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('view'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
        getUser: vi.fn().mockReturnValue(null),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    const replyPayload = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(replyPayload).toBeDefined();
    expect(containsText(replyPayload, /Beatrice Vance/)).toBe(true);
    expect(containsText(replyPayload, /Current Delegate/)).toBe(true);
    expect(containsText(replyPayload, /Former Chancellor/)).toBe(false);
  });

  it('does not expose favour balances in the character dossier', async () => {
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return selectLimitResult([{
          id: 'player-1',
          characterName: 'Ada Vance',
          characterBio: 'A parliamentary comet.',
          characterPortraitUrl: null,
          currentAge: 32,
          startingAge: 30,
          factionId: 'faction-1',
          partyId: 'party-1',
          healthStatus: 'healthy',
          ailments: [],
          isAlive: true,
          causeOfDeath: null,
        }]);
      }
      if (selectCall === 2) return selectLimitResult([{ name: 'Commons' }]);
      if (selectCall === 3) return selectLimitResult([{ name: 'Reform League' }]);
      if (selectCall === 4) return selectInnerJoinWhereResult([]);
      if (selectCall === 5) {
        return selectInnerJoinWhereResult([{
          categoryName: 'Court Influence',
          categoryEmoji: 'CI',
          balance: 42,
        }]);
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const interaction = {
      user: { id: 'discord-user-1', displayName: 'Ada' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('view'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
        getUser: vi.fn().mockReturnValue(null),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    const replyPayload = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(replyPayload).toBeDefined();
    expect(containsText(replyPayload, /Favours/i)).toBe(false);
    expect(containsText(replyPayload, /Court Influence|42/)).toBe(false);
  });

  it('refreshes a Discord attachment portrait from stored source-message metadata', async () => {
    let selectCall = 0;
    const freshPortraitUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Kaylie.png?ex=fresh&is=fresh&hm=fresh';
    const stalePortraitUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Kaylie.png?ex=65d903de&is=65c68ede&hm=old';

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return selectLimitResult([{
          id: 'player-1',
          characterName: 'Kaylie Lykos',
          characterBio: 'Wolf at the chamber door.',
          characterPortraitUrl: stalePortraitUrl,
          profileData: {
            characterPortraitAttachment: {
              channelId: 'channel-1',
              messageId: 'message-1',
              attachmentId: 'attachment-1',
            },
          },
          currentAge: 27,
          startingAge: 27,
          factionId: null,
          partyId: null,
          healthStatus: 'healthy',
          ailments: [],
          isAlive: true,
          causeOfDeath: null,
        }]);
      }
      if (selectCall === 2) return selectInnerJoinWhereResult([]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const interaction = {
      user: { id: 'discord-user-1', displayName: 'Kaylie' },
      client: {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            messages: {
              fetch: vi.fn().mockResolvedValue({
                attachments: new Map([
                  ['attachment-1', {
                    id: 'attachment-1',
                    contentType: 'image/png',
                    url: freshPortraitUrl,
                  }],
                ]),
              }),
            },
          }),
        },
      },
      options: {
        getSubcommand: vi.fn().mockReturnValue('view'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
        getUser: vi.fn().mockReturnValue(null),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    const replyPayload = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(replyPayload?.embeds?.[0]?.data?.thumbnail?.url).toBe(freshPortraitUrl);
  });

  it('does not send an expired Discord attachment URL when there is no source metadata to refresh', async () => {
    let selectCall = 0;
    const expiredPortraitUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Kaylie.png?ex=65d903de&is=65c68ede&hm=old';

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return selectLimitResult([{
          id: 'player-1',
          characterName: 'Kaylie Lykos',
          characterBio: 'Wolf at the chamber door.',
          characterPortraitUrl: expiredPortraitUrl,
          profileData: null,
          currentAge: 27,
          startingAge: 27,
          factionId: null,
          partyId: null,
          healthStatus: 'healthy',
          ailments: [],
          isAlive: true,
          causeOfDeath: null,
        }]);
      }
      if (selectCall === 2) return selectInnerJoinWhereResult([]);
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const interaction = {
      user: { id: 'discord-user-1', displayName: 'Kaylie' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('view'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
        getUser: vi.fn().mockReturnValue(null),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await command.execute(interaction as any);

    const replyPayload = interaction.editReply.mock.calls.at(-1)?.[0];
    expect(replyPayload?.embeds?.[0]?.data?.thumbnail).toBeUndefined();
    expect(containsText(replyPayload, /portrait link has expired/i)).toBe(true);
  });
});

describe('/character edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears direct-upload attachment metadata when the portrait URL changes', async () => {
    const oldPortraitUrl = 'https://cdn.discordapp.com/attachments/channel-1/attachment-1/Old.png?ex=fresh&is=fresh&hm=fresh';
    const newPortraitUrl = 'https://example.com/new-kaylie.png';

    mocks.select.mockImplementation(() => selectLimitResult([{
      id: 'player-1',
      characterName: 'Kaylie Lykos',
      characterBio: 'Wolf at the chamber door.',
      characterPortraitUrl: oldPortraitUrl,
      profileData: {
        pronouns: 'she/her',
        characterPortraitAttachment: {
          channelId: 'channel-1',
          messageId: 'message-1',
          attachmentId: 'attachment-1',
        },
      },
    }]));

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.update.mockReturnValue({ set: updateSet });
    mocks.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_bio: 'Wolf at the chamber door.',
          character_portrait: newPortraitUrl,
        })[field] ?? ''),
      },
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('edit'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
      },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      characterPortraitUrl: newPortraitUrl,
      profileData: { pronouns: 'she/her' },
    }));
  });

  it('registers the edit modal awaiter for stale-token recovery with a 14-minute window', async () => {
    mocks.select.mockImplementation(() => selectLimitResult([{
      id: 'player-1',
      characterName: 'Kaylie Lykos',
      characterBio: 'Wolf at the chamber door.',
      characterPortraitUrl: null,
      profileData: null,
    }]));

    const interaction = {
      user: { id: 'discord-user-1' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('edit'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
      },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockRejectedValue(new Error('timed out')),
    };

    await command.execute(interaction as any);

    expect(interaction.awaitModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ time: 840_000 }),
    );
    expect(mocks.registerAwaitingInteraction).toHaveBeenCalledWith('char_edit_discord-user-1');
    expect(mocks.unregisterAwaitingInteraction).toHaveBeenCalledWith('char_edit_discord-user-1');
  });
});
