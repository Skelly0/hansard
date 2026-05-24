import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const mocks = vi.hoisted(() => ({
  svc: {
    completeTapDelivery: vi.fn(),
    countTrailingTapFailures: vi.fn(),
    findOrReserveThread: vi.fn(),
    getActiveTapsForNumbers: vi.fn(),
    isTapActive: vi.fn(),
    recordVoicemailPrompt: vi.fn(),
    updateMessageMirrorIds: vi.fn(),
  },
}));

vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(function PhoneService() {
    return mocks.svc;
  }),
}));

const {
  __internal,
  RecipientDmClosedError,
  relayMessage,
  sendStaffJoinPing,
  sendVoicemailBeep,
  sendVoicemailIntro,
} = await import('./phoneRelay.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.svc.completeTapDelivery.mockResolvedValue(undefined);
  mocks.svc.countTrailingTapFailures.mockResolvedValue(0);
  mocks.svc.findOrReserveThread.mockResolvedValue({ thread: null, pair: ['caller-player', 'recipient-player'] });
  mocks.svc.getActiveTapsForNumbers.mockResolvedValue([]);
  mocks.svc.isTapActive.mockResolvedValue(true);
  mocks.svc.recordVoicemailPrompt.mockResolvedValue({
    message: { id: 'message-1', content: 'prompt' },
    tapDeliveries: [],
  });
  mocks.svc.updateMessageMirrorIds.mockResolvedValue(undefined);
});

describe('phoneRelay.chunkText', () => {
  it('returns the input unchanged when it fits within the budget', () => {
    expect(__internal.chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits long text on a newline when possible', () => {
    const text = 'a'.repeat(50) + '\n' + 'b'.repeat(50);
    const chunks = __internal.chunkText(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(60);
  });

  it('splits on a space when no newline is available within the budget', () => {
    const text = 'word '.repeat(100); // 500 chars total
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    // No chunk should end mid-word.
    for (const c of chunks.slice(0, -1)) {
      expect(/\w$/.test(c)).toBe(true);
    }
  });

  it('falls back to a hard split when no word/newline boundary exists in budget', () => {
    const text = 'x'.repeat(500);
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it('preserves the full content across chunks', () => {
    const text = 'a'.repeat(250);
    const chunks = __internal.chunkText(text, 100);
    expect(chunks.join('').length).toBe(text.length);
  });
});

describe('phoneRelay.chunkText — codepoint boundary safety (H3)', () => {
  // A 4-byte emoji is a UTF-16 surrogate pair (length 2). A naive `slice` at a budget that
  // lands between the halves splits the pair, and each half renders as `?`. The fix backs
  // the cut up by one when it lands on a low surrogate.

  it('never splits a surrogate pair across a hard-split boundary', () => {
    // 60 emoji, no spaces/newlines → forces the hard-split branch. Each emoji is 2 UTF-16
    // units, so a budget of 25 lands cuts inside pairs unless the fix backs them up.
    const emoji = '\u{1F600}'; // 😀, surrogate pair
    const text = emoji.repeat(60);
    const chunks = __internal.chunkText(text, 25);
    // Reassembly must be byte-identical and contain zero lone surrogates.
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i++) {
        const code = chunk.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          // high surrogate must be followed by a low surrogate
          const next = chunk.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          i++;
        } else {
          // must not be a lone low surrogate
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
    }
  });

  it('keeps every emoji intact when the budget is odd relative to the pair width', () => {
    const emoji = '\u{1F4DE}'; // 📞
    const text = `${emoji} `.repeat(40);
    const chunks = __internal.chunkText(text, 15);
    // No chunk should contain a lone surrogate; full content preserved (modulo trim, so
    // compare on the surrogate-pair count).
    const pairCount = (s: string) => Array.from(s).filter((c) => c.codePointAt(0)! > 0xffff).length;
    expect(chunks.reduce((n, c) => n + pairCount(c), 0)).toBe(40);
  });

  it('does not corrupt content when a surrogate pair sits right at the budget edge', () => {
    // 24 ASCII chars then an emoji, budget 25 → the cut at 25 lands on the low surrogate.
    const text = 'a'.repeat(24) + '\u{1F600}' + 'b'.repeat(30);
    const chunks = __internal.chunkText(text, 25);
    expect(chunks.join('')).toBe(text);
    expect(Array.from(chunks.join('')).filter((c) => c.codePointAt(0)! > 0xffff)).toHaveLength(1);
  });

  it('preserves a fenced code block across chunks (no fence-aware splitting, but no corruption)', () => {
    // The chunker is not markdown-aware — it may break a fence across chunks. What it must
    // NOT do is corrupt the content. Chunks are trimmed at split boundaries, so reassembly
    // is content-identical once boundary whitespace is normalized; the non-whitespace
    // payload (the actual code) is byte-for-byte preserved.
    const fence = '```\n' + 'const x = 1;\n'.repeat(40) + '```';
    const chunks = __internal.chunkText(fence, 80);
    expect(chunks.length).toBeGreaterThan(1);
    // Non-whitespace payload is fully preserved — no characters dropped or duplicated.
    expect(chunks.join('').replace(/\s+/g, '')).toBe(fence.replace(/\s+/g, ''));
    // The backtick fence markers survive (count preserved).
    const backticks = (s: string) => (s.match(/`/g) ?? []).length;
    expect(chunks.reduce((n, c) => n + backticks(c), 0)).toBe(backticks(fence));
  });
});

describe('phoneRelay.chunkForDm / chunkForEmbed budgets', () => {
  it('chunkForDm keeps every chunk within the ~1900 DM budget', () => {
    const chunks = __internal.chunkForDm('z'.repeat(5000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1900)).toBe(true);
  });

  it('chunkForEmbed keeps every chunk within the 4000 embed budget', () => {
    const chunks = __internal.chunkForEmbed('z'.repeat(12000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  });

  it('short content is a single chunk under both budgets', () => {
    expect(__internal.chunkForDm('hi there')).toEqual(['hi there']);
    expect(__internal.chunkForEmbed('hi there')).toEqual(['hi there']);
  });
});

describe('phoneRelay.isDmClosedError (50007 matcher)', () => {
  it('matches a numeric 50007 code', () => {
    expect(__internal.isDmClosedError({ code: 50007 })).toBe(true);
  });

  it('matches a string "50007" code', () => {
    expect(__internal.isDmClosedError({ code: '50007' })).toBe(true);
  });

  it('does not match other Discord error codes', () => {
    expect(__internal.isDmClosedError({ code: 10062 })).toBe(false);
    expect(__internal.isDmClosedError({ code: '10003' })).toBe(false);
  });

  it('does not match non-error values', () => {
    expect(__internal.isDmClosedError(null)).toBe(false);
    expect(__internal.isDmClosedError(undefined)).toBe(false);
    expect(__internal.isDmClosedError('boom')).toBe(false);
    expect(__internal.isDmClosedError(new Error('plain'))).toBe(false);
  });
});

describe('phoneRelay.sendToRecipient', () => {
  const senderNumber = { numberRaw: '+15550142' } as never;

  it('returns the first DM message id on success', async () => {
    const client = {
      users: {
        fetch: async () => ({
          send: async () => ({ id: 'dm-1' }),
        }),
      },
    } as never;
    const id = await __internal.sendToRecipient(client, 'recipient-discord', senderNumber, 'hello');
    expect(id).toBe('dm-1');
  });

  it('uses the sender number pseudonym in recipient DM prefixes when present', async () => {
    const sent: string[] = [];
    const client = {
      users: {
        fetch: async () => ({
          send: async ({ content }: { content: string }) => {
            sent.push(content);
            return { id: 'dm-1' };
          },
        }),
      },
    } as never;
    await __internal.sendToRecipient(
      client,
      'recipient-discord',
      { numberRaw: '+15550142', pseudonym: 'The Night Clerk' } as never,
      'hello',
    );
    expect(sent[0]).toBe('**The Night Clerk (+15550142):** hello');
  });

  it('throws RecipientDmClosedError when the recipient has DMs closed (50007)', async () => {
    const client = {
      users: {
        fetch: async () => ({
          send: async () => {
            throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
          },
        }),
      },
    } as never;
    await expect(
      __internal.sendToRecipient(client, 'recipient-discord', senderNumber, 'hello'),
    ).rejects.toBeInstanceOf(RecipientDmClosedError);
  });

  it('rethrows non-DM-closed send failures unchanged', async () => {
    const client = {
      users: {
        fetch: async () => ({
          send: async () => {
            throw Object.assign(new Error('rate limited'), { code: 429 });
          },
        }),
      },
    } as never;
    await expect(
      __internal.sendToRecipient(client, 'recipient-discord', senderNumber, 'hello'),
    ).rejects.not.toBeInstanceOf(RecipientDmClosedError);
  });

  it('chunks long content into multiple DMs and still returns the first id', async () => {
    const sent: string[] = [];
    const client = {
      users: {
        fetch: async () => ({
          send: async ({ content }: { content: string }) => {
            sent.push(content);
            return { id: `dm-${sent.length}` };
          },
        }),
      },
    } as never;
    const id = await __internal.sendToRecipient(client, 'r', senderNumber, 'q'.repeat(5000));
    expect(id).toBe('dm-1');
    expect(sent.length).toBeGreaterThan(1);
    // Multi-chunk sends carry a [i/n] progress marker.
    expect(sent[0]).toContain('[1/');
  });
});

describe('phoneRelay voicemail transition descriptions', () => {
  it('names the caller number when the called line is sent to voicemail', () => {
    const description = (__internal as any).formatVoicemailSentDescription({
      callerNumber: { numberRaw: '213' },
    });

    expect(description).toBe('The caller from 213 was sent to voicemail.');
  });

  it('uses the caller number pseudonym when one is configured', () => {
    const description = (__internal as any).formatVoicemailSentDescription({
      callerNumber: { numberRaw: '+15550142', pseudonym: 'The Night Clerk' },
    });

    expect(description).toBe('The caller from The Night Clerk (+15550142) was sent to voicemail.');
  });
});

describe('phoneRelay voicemail prompts', () => {
  const context = {
    call: {
      id: 'call-1',
      voicemailEnabled: true,
      voicemailIntroMessage: 'The line keeps ringing.',
      voicemailPostBeepMessage: 'Leave a message now.',
      staffThreadId: null,
    },
    callerPlayer: { id: 'caller-player', discordId: 'caller-discord', characterName: 'Caller' },
    recipientPlayer: { id: 'recipient-player', discordId: 'recipient-discord', characterName: 'Recipient' },
    callerNumber: { id: 'caller-number', numberRaw: '111' },
    recipientNumber: { id: 'recipient-number', numberRaw: '222' },
  } as never;

  function makeClient() {
    const sent: string[] = [];
    return {
      sent,
      client: {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
        users: {
          fetch: vi.fn().mockResolvedValue({
            send: vi.fn(async ({ content }: { content: string }) => {
              sent.push(content);
              return { id: `dm-${sent.length}` };
            }),
          }),
        },
      } as never,
    };
  }

  it('records and mirrors the intro through the call ledger before DM delivery is reconciled', async () => {
    const { client, sent } = makeClient();
    mocks.svc.recordVoicemailPrompt.mockResolvedValueOnce({
      message: { id: 'message-intro', content: 'The line keeps ringing.' },
      tapDeliveries: [],
    });

    await sendVoicemailIntro(client, context);

    expect(mocks.svc.recordVoicemailPrompt).toHaveBeenCalledWith({
      callId: 'call-1',
      content: 'The line keeps ringing.',
      expectedStatus: 'ringing',
    });
    expect(mocks.svc.updateMessageMirrorIds).toHaveBeenCalledWith('message-intro', {
      recipientDiscordMessageId: 'dm-1',
      staffMirrorMessageId: null,
    });
    expect(sent[0]).toContain('The line keeps ringing.');
  });

  it('records and mirrors the peep plus after-peep message through the call ledger', async () => {
    const { client, sent } = makeClient();
    mocks.svc.recordVoicemailPrompt.mockResolvedValueOnce({
      message: { id: 'message-peep', content: '<peep>\nLeave a message now.' },
      tapDeliveries: [],
    });

    await sendVoicemailBeep(client, context);

    expect(mocks.svc.recordVoicemailPrompt).toHaveBeenCalledWith({
      callId: 'call-1',
      content: '<peep>\nLeave a message now.',
      expectedStatus: 'voicemail',
    });
    expect(mocks.svc.updateMessageMirrorIds).toHaveBeenCalledWith('message-peep', {
      recipientDiscordMessageId: 'dm-1',
      staffMirrorMessageId: null,
    });
    expect(sent[0]).toContain('<peep>');
    expect(sent[0]).toContain('Leave a message now.');
  });
});

describe('phoneRelay tap mirror channel validation', () => {
  const guild = { id: 'G1', roles: { everyone: { id: 'G1' } } };
  const makeChannel = (everyoneCanView: boolean) => ({
    id: 'C1',
    type: 0,
    guild,
    permissionsFor: () => ({
      has: (perm: string) => perm === 'ViewChannel' && everyoneCanView,
    }),
  });

  it('refuses a public env fallback tap channel before delivery', () => {
    expect(__internal.validateTapMirrorChannel(makeChannel(true) as never)).toMatch(/must be private/i);
  });

  it('allows a private env fallback tap channel', () => {
    expect(__internal.validateTapMirrorChannel(makeChannel(false) as never)).toBeNull();
  });
});

describe('phoneRelay tap delivery', () => {
  it('suppresses all mention parsing when posting tap copies to a mirror channel', async () => {
    const previousPhoneLogChannelId = process.env.PHONE_LOG_CHANNEL_ID;
    delete process.env.PHONE_LOG_CHANNEL_ID;
    try {
      const channelSend = vi.fn(async () => ({ id: 'tap-channel-message' }));
      const recipientSend = vi.fn(async () => ({ id: 'recipient-message' }));
      const tapChannel = {
        id: 'tap-channel',
        type: 0,
        guild: { id: 'G1', roles: { everyone: { id: 'G1' } } },
        permissionsFor: () => ({ has: () => false }),
        send: channelSend,
      };
      const client = {
        channels: { fetch: vi.fn(async () => tapChannel) },
        users: { fetch: vi.fn(async () => ({ send: recipientSend })) },
      } as any;

      mocks.svc.getActiveTapsForNumbers.mockResolvedValueOnce([
        { id: 'tap-1', mirrorChannelId: 'tap-channel', mirrorDiscordUserId: null },
      ]);

      await relayMessage(
        client,
        {
          call: { id: 'call-12345678', staffThreadId: null },
          callerNumber: { id: 'caller-number', numberRaw: '111', pseudonym: null },
          recipientNumber: { id: 'recipient-number', numberRaw: '222', pseudonym: null },
          callerPlayer: { id: 'caller-player', characterName: 'Alice', discordId: 'alice-discord', isAlive: true },
          recipientPlayer: { id: 'recipient-player', characterName: 'Bob', discordId: 'bob-discord', isAlive: true },
        } as any,
        {
          message: { id: 'message-1', content: 'hey <@123> <@&456> @everyone' },
          tapDeliveries: [{ id: 'delivery-1', tapId: 'tap-1' }],
        } as any,
        true,
      );

      expect(channelSend).toHaveBeenCalledWith(expect.objectContaining({
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
      }));
    } finally {
      if (previousPhoneLogChannelId === undefined) {
        delete process.env.PHONE_LOG_CHANNEL_ID;
      } else {
        process.env.PHONE_LOG_CHANNEL_ID = previousPhoneLogChannelId;
      }
    }
  });
});

describe('phoneRelay staff thread opener mentions', () => {
  it('does not allow player names to mention users or everyone when opening a phone log', async () => {
    const previousStaffRoleIds = process.env.STAFF_ROLE_IDS;
    const previousStaffRoleId = process.env.STAFF_ROLE_ID;
    process.env.STAFF_ROLE_IDS = 'staff-role';
    delete process.env.STAFF_ROLE_ID;
    try {
      const thread = { send: vi.fn(async () => ({ id: 'thread-message' })) };
      const guild = {
        members: { cache: new Map(), fetch: vi.fn(async () => new Map()) },
        roles: { cache: new Map(), fetch: vi.fn() },
      };

      await sendStaffJoinPing(thread as any, guild as any, '<@123>', '@everyone');

      expect(thread.send).toHaveBeenNthCalledWith(1, expect.objectContaining({
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
      }));
      expect(thread.send).toHaveBeenNthCalledWith(2, expect.objectContaining({
        allowedMentions: { parse: [], users: [], roles: ['staff-role'], repliedUser: false },
      }));
    } finally {
      if (previousStaffRoleIds === undefined) {
        delete process.env.STAFF_ROLE_IDS;
      } else {
        process.env.STAFF_ROLE_IDS = previousStaffRoleIds;
      }
      if (previousStaffRoleId === undefined) {
        delete process.env.STAFF_ROLE_ID;
      } else {
        process.env.STAFF_ROLE_ID = previousStaffRoleId;
      }
    }
  });
});
