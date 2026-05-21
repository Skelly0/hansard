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

const { __internal, flushQueuedPhoneTextsForPlayer } = await import('./phoneTextRelay.js');

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
});
