import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const mocks = vi.hoisted(() => ({
  callSvc: {
    autoRevokeBrokenTap: vi.fn(),
    findOpenCallForPlayer: vi.fn(),
  },
  textSvc: {
    claimDeliveryForSend: vi.fn(),
    completeTapDelivery: vi.fn(),
    getQueuedDeliveriesForPlayer: vi.fn(),
    isTapActive: vi.fn(),
    markDeliveryDelivered: vi.fn(),
    markDeliveryFailed: vi.fn(),
    releaseDeliveryClaim: vi.fn(),
    setStaffThread: vi.fn(),
    updateMessageMirrorIds: vi.fn(),
  },
}));

vi.mock('../db.js', () => ({ db: {} }));

vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(function PhoneService() {
    return mocks.callSvc;
  }),
}));

vi.mock('@hansard/api/services/phoneTextService', () => ({
  PhoneTextService: vi.fn(function PhoneTextService() {
    return mocks.textSvc;
  }),
}));

const { __internal, flushQueuedPhoneTextsForPlayer, relayRecordedPhoneText } = await import('./phoneTextRelay.js');

function participant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    playerId: 'player-a',
    numberId: 'number-a',
    numberRaw: '111',
    numberNormalized: '111',
    pseudonym: null,
    characterName: 'Alice',
    discordId: 'discord-a',
    discordUsername: 'Alice',
    ...overrides,
  };
}

function queuedDelivery() {
  return {
    conversation: { id: 'conversation-1' },
    message: {
      id: 'message-1',
      content: 'hello',
      senderPlayerId: 'player-a',
    },
    delivery: { id: 'delivery-1' },
    sender: participant({ playerId: 'player-a', numberId: 'number-a', discordId: 'discord-a' }),
    recipient: participant({
      playerId: 'player-b',
      numberId: 'number-b',
      numberRaw: '222',
      numberNormalized: '222',
      characterName: 'Bob',
      discordId: 'discord-b',
      discordUsername: 'Bob',
    }),
  };
}

function makeClient() {
  const sent: unknown[] = [];
  const user = {
    send: vi.fn(async (payload: unknown) => {
      sent.push(payload);
      return { id: 'dm-1' };
    }),
  };
  return {
    sent,
    client: {
      users: { fetch: vi.fn(async () => user) },
      channels: { fetch: vi.fn() },
    } as any,
    user,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callSvc.autoRevokeBrokenTap.mockResolvedValue(undefined);
  mocks.callSvc.findOpenCallForPlayer.mockResolvedValue(null);
  mocks.textSvc.claimDeliveryForSend.mockResolvedValue({ id: 'delivery-1' });
  mocks.textSvc.completeTapDelivery.mockResolvedValue(undefined);
  mocks.textSvc.getQueuedDeliveriesForPlayer.mockResolvedValue([]);
  mocks.textSvc.isTapActive.mockResolvedValue(true);
  mocks.textSvc.markDeliveryDelivered.mockResolvedValue(undefined);
  mocks.textSvc.markDeliveryFailed.mockResolvedValue(undefined);
  mocks.textSvc.releaseDeliveryClaim.mockResolvedValue(undefined);
  mocks.textSvc.setStaffThread.mockResolvedValue(undefined);
  mocks.textSvc.updateMessageMirrorIds.mockResolvedValue(undefined);
});

describe('flushQueuedPhoneTextsForPlayer', () => {
  it('leaves queued texts untouched while the recipient is on a call', async () => {
    const { client } = makeClient();
    mocks.callSvc.findOpenCallForPlayer.mockResolvedValue({ id: 'call-1' });

    await expect(flushQueuedPhoneTextsForPlayer(client, 'player-b')).resolves.toBe(0);

    expect(mocks.textSvc.getQueuedDeliveriesForPlayer).not.toHaveBeenCalled();
    expect(mocks.textSvc.claimDeliveryForSend).not.toHaveBeenCalled();
  });

  it('skips a queued row when another worker already claimed it', async () => {
    const { client } = makeClient();
    mocks.textSvc.getQueuedDeliveriesForPlayer.mockResolvedValue([queuedDelivery()]);
    mocks.textSvc.claimDeliveryForSend.mockResolvedValue(null);

    await expect(flushQueuedPhoneTextsForPlayer(client, 'player-b')).resolves.toBe(0);

    expect(mocks.textSvc.claimDeliveryForSend).toHaveBeenCalledWith('delivery-1');
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(mocks.textSvc.markDeliveryDelivered).not.toHaveBeenCalled();
  });

  it('releases the claim if a call opens after claiming but before the DM send', async () => {
    const { client } = makeClient();
    mocks.textSvc.getQueuedDeliveriesForPlayer.mockResolvedValue([queuedDelivery()]);
    mocks.callSvc.findOpenCallForPlayer
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'call-1' });

    await expect(flushQueuedPhoneTextsForPlayer(client, 'player-b')).resolves.toBe(0);

    expect(mocks.textSvc.releaseDeliveryClaim).toHaveBeenCalledWith('delivery-1');
    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it('marks the delivery delivered after a successful claimed DM send', async () => {
    const { client } = makeClient();
    mocks.textSvc.getQueuedDeliveriesForPlayer.mockResolvedValue([queuedDelivery()]);

    await expect(flushQueuedPhoneTextsForPlayer(client, 'player-b')).resolves.toBe(1);

    expect(client.users.fetch).toHaveBeenCalledWith('discord-b');
    expect(mocks.textSvc.markDeliveryDelivered).toHaveBeenCalledWith('delivery-1', 'dm-1');
  });
});

describe('phone text tap delivery', () => {
  it('re-checks tap activity before posting a copied text anywhere', async () => {
    const { client } = makeClient();
    mocks.textSvc.isTapActive.mockResolvedValue(false);

    await (__internal as any).deliverTapCopy(
      client,
      mocks.textSvc,
      {
        id: 'tap-1',
        mirrorChannelId: 'tap-channel',
        mirrorDiscordUserId: 'tap-user',
      },
      'tap-delivery-1',
      {
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1', content: 'secret' },
        sender: participant(),
        recipient: participant({
          playerId: 'player-b',
          numberId: 'number-b',
          numberRaw: '222',
          numberNormalized: '222',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        }),
      },
    );

    expect(mocks.textSvc.completeTapDelivery).toHaveBeenCalledWith(
      'tap-delivery-1',
      { error: 'tap revoked before delivery' },
    );
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it('suppresses all mention parsing when posting tap text copies to a mirror channel', async () => {
    const { client } = makeClient();
    const channelSend = vi.fn(async () => ({ id: 'tap-channel-message' }));
    (client.channels.fetch as any).mockResolvedValue({
      id: 'tap-channel',
      type: 0,
      guild: { id: 'G1', roles: { everyone: { id: 'G1' } } },
      permissionsFor: () => ({ has: () => false }),
      send: channelSend,
    });

    await (__internal as any).deliverTapCopy(
      client,
      mocks.textSvc,
      {
        id: 'tap-1',
        mirrorChannelId: 'tap-channel',
        mirrorDiscordUserId: null,
      },
      'tap-delivery-1',
      {
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1', content: 'secret <@123> <@&456> @everyone' },
        sender: participant(),
        recipient: participant({
          playerId: 'player-b',
          numberId: 'number-b',
          numberRaw: '222',
          numberNormalized: '222',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        }),
      },
    );

    expect(channelSend).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    }));
  });
});

describe('phone text staff thread opener mentions', () => {
  it('does not allow participant names to mention users or everyone when opening a text log', async () => {
    const previousPhoneLogChannelId = process.env.PHONE_LOG_CHANNEL_ID;
    const previousStaffRoleIds = process.env.STAFF_ROLE_IDS;
    const previousStaffRoleId = process.env.STAFF_ROLE_ID;
    process.env.PHONE_LOG_CHANNEL_ID = 'phone-log-channel';
    process.env.STAFF_ROLE_IDS = 'staff-role';
    delete process.env.STAFF_ROLE_ID;
    try {
      const threadSend = vi.fn(async () => ({ id: 'thread-message' }));
      const thread = { id: 'text-thread', send: threadSend };
      const logChannel = {
        id: 'phone-log-channel',
        type: 0,
        guild: { roles: { cache: new Map(), fetch: vi.fn() } },
        threads: { create: vi.fn(async () => thread) },
      };
      const client = {
        channels: { fetch: vi.fn(async () => logChannel) },
        users: { fetch: vi.fn() },
      } as any;

      await relayRecordedPhoneText(client, {
        conversation: { id: 'conversation-1', staffThreadId: null },
        message: { id: 'message-1', content: 'hello' },
        sender: participant({ characterName: '<@123>' }),
        recipient: participant({
          playerId: 'player-b',
          numberId: 'number-b',
          numberRaw: '222',
          numberNormalized: '222',
          characterName: '@everyone',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        }),
        tapDeliveries: [],
      } as any);

      expect(threadSend).toHaveBeenNthCalledWith(1, expect.objectContaining({
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
      }));
      expect(threadSend).toHaveBeenNthCalledWith(2, expect.objectContaining({
        allowedMentions: { parse: [], users: [], roles: ['staff-role'], repliedUser: false },
      }));
    } finally {
      if (previousPhoneLogChannelId === undefined) {
        delete process.env.PHONE_LOG_CHANNEL_ID;
      } else {
        process.env.PHONE_LOG_CHANNEL_ID = previousPhoneLogChannelId;
      }
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
