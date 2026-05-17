import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Events } from 'discord.js';

const mocks = vi.hoisted(() => ({
  dbRows: [] as unknown[][],
  svc: {
    findOpenCallForPlayer: vi.fn(),
    getCallParticipants: vi.fn(),
    recordMessage: vi.fn(),
    systemEndCall: vi.fn(),
  },
  relayMessage: vi.fn(),
  hangUpAndNotify: vi.fn(),
  postCallOpenedToStaffThread: vi.fn(),
}));

class MockPhoneServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

class MockRecipientDmClosedError extends Error {
  constructor(public discordUserId: string, cause?: unknown) {
    super('Recipient DM closed');
    this.cause = cause;
  }
}

vi.mock('../db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mocks.dbRows.shift() ?? [])),
        })),
      })),
    })),
  },
}));

vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(function PhoneService() {
    return mocks.svc;
  }),
  PhoneServiceError: MockPhoneServiceError,
}));

vi.mock('../utils/phoneRelay.js', () => ({
  RecipientDmClosedError: MockRecipientDmClosedError,
  hangUpAndNotify: mocks.hangUpAndNotify,
  postCallOpenedToStaffThread: mocks.postCallOpenedToStaffThread,
  relayMessage: mocks.relayMessage,
}));

const { registerMessageCreateEvent } = await import('./messageCreate.js');

function makeClient() {
  let handler: ((message: unknown) => Promise<void>) | null = null;
  const client = {
    on: vi.fn((event: string, cb: (message: unknown) => Promise<void>) => {
      if (event === Events.MessageCreate) handler = cb;
    }),
  };
  registerMessageCreateEvent(client as never);
  if (!handler) throw new Error('messageCreate handler was not registered');
  return { client, handler };
}

function makeMessage(content = 'call me back') {
  return {
    id: 'discord-message-1',
    partial: false,
    author: { id: 'discord-caller', bot: false },
    channel: { type: ChannelType.DM },
    content,
    react: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function setupVoicemailCall(voicemailBeepedAt: Date | null = new Date('2026-05-15T12:00:00.000Z')) {
  const call = {
    id: 'call-1',
    status: 'voicemail',
    voicemailBeepedAt,
    callerPlayerId: 'player-caller',
    recipientPlayerId: 'player-recipient',
    staffThreadId: null,
  };
  const participants = {
    call,
    callerPlayer: { id: 'player-caller', discordId: 'discord-caller', characterName: 'Caller' },
    recipientPlayer: { id: 'player-recipient', discordId: 'discord-recipient', characterName: 'Recipient' },
    callerNumber: { id: 'number-caller', numberRaw: '111' },
    recipientNumber: { id: 'number-recipient', numberRaw: '222' },
  };
  mocks.dbRows.push([{ id: 'player-caller', isAlive: true, characterName: 'Caller' }]);
  mocks.svc.findOpenCallForPlayer.mockResolvedValue(call);
  mocks.svc.getCallParticipants.mockResolvedValue(participants);
  return { call, participants };
}

describe('messageCreate voicemail DM flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbRows.length = 0;
    mocks.svc.recordMessage.mockResolvedValue({
      message: { id: 'message-1', content: 'call me back' },
      tapDeliveries: [],
    });
    mocks.svc.systemEndCall.mockResolvedValue({ id: 'call-1', status: 'ended' });
    mocks.relayMessage.mockResolvedValue(undefined);
  });

  it('does not record voicemail before the peep has sounded', async () => {
    const { handler } = makeClient();
    const message = makeMessage();
    setupVoicemailCall(null);

    await handler(message);

    expect(mocks.svc.recordMessage).not.toHaveBeenCalled();
    const reply = message.reply.mock.calls[0]?.[0] as { content?: string };
    expect(reply.content).toContain('ringing');
    expect(reply.content?.toLowerCase()).not.toContain('voicemail');
    expect(reply.content?.toLowerCase()).not.toContain('peep');
  });

  it('records, relays, and ends voicemail after the peep', async () => {
    const { handler, client } = makeClient();
    const message = makeMessage();
    const { participants } = setupVoicemailCall();

    await handler(message);

    expect(mocks.svc.recordMessage).toHaveBeenCalledWith({
      callId: 'call-1',
      senderPlayerId: 'player-caller',
      content: 'call me back',
      senderDiscordMessageId: 'discord-message-1',
    });
    expect(mocks.relayMessage).toHaveBeenCalledWith(client, participants, expect.any(Object), true);
    expect(mocks.svc.systemEndCall).toHaveBeenCalledWith('call-1', 'voicemail_left');
    expect(message.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Voicemail delivered.' }),
    );
  });

  it('still ends voicemail when delivery to the recipient fails', async () => {
    const { handler } = makeClient();
    const message = makeMessage();
    setupVoicemailCall();
    mocks.relayMessage.mockRejectedValueOnce(new Error('relay failed'));

    await handler(message);

    expect(mocks.svc.systemEndCall).toHaveBeenCalledWith('call-1', 'voicemail_left');
    expect(message.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('could not DM') }),
    );
  });
});
