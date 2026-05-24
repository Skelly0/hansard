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
  textSvc: {
    resolveReplyConversation: vi.fn(),
    recordReply: vi.fn(),
  },
  relayMessage: vi.fn(),
  hangUpAndNotify: vi.fn(),
  postCallOpenedToStaffThread: vi.fn(),
  relayRecordedPhoneText: vi.fn(),
  flushQueuedPhoneTextsForPlayer: vi.fn(),
  ticketAddMessage: vi.fn(),
  notifyTicketOwnerOfReply: vi.fn(),
  isStaff: vi.fn(),
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

class MockPhoneTextServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
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

vi.mock('@hansard/api/services/phoneTextService', () => ({
  PhoneTextService: vi.fn(function PhoneTextService() {
    return mocks.textSvc;
  }),
  PhoneTextServiceError: MockPhoneTextServiceError,
  phoneTextReplyHintForResolution: (resolution: { status: string }) => {
    if (resolution.status === 'none') return 'No phone text conversation is selected.';
    if (resolution.status === 'multiple') return 'You have multiple active phone text conversations.';
    return null;
  },
}));

vi.mock('@hansard/api/services/ticketService', () => ({
  TicketService: vi.fn(function TicketService() {
    return {
      addMessage: mocks.ticketAddMessage,
    };
  }),
}));

vi.mock('@hansard/api/services/ticketOwnerNotifier', () => ({
  notifyTicketOwnerOfReply: mocks.notifyTicketOwnerOfReply,
}));

vi.mock('../utils/phoneRelay.js', () => ({
  RecipientDmClosedError: MockRecipientDmClosedError,
  hangUpAndNotify: mocks.hangUpAndNotify,
  postCallOpenedToStaffThread: mocks.postCallOpenedToStaffThread,
  relayMessage: mocks.relayMessage,
}));

vi.mock('../utils/phoneTextRelay.js', () => ({
  flushQueuedPhoneTextsForPlayer: mocks.flushQueuedPhoneTextsForPlayer,
  relayRecordedPhoneText: mocks.relayRecordedPhoneText,
}));

vi.mock('../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

const { clearNoCallCache, registerMessageCreateEvent } = await import('./messageCreate.js');

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

function makeThreadMessage(content = 'ticket reply') {
  return {
    id: 'discord-message-1',
    partial: false,
    author: { id: 'discord-caller', bot: false },
    member: { roles: { cache: new Map() } },
    channel: { id: 'thread-42', type: ChannelType.PrivateThread },
    content,
    attachments: new Map(),
    stickers: new Map(),
    react: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function setupResolvedPlayer() {
  mocks.dbRows.push([{ id: 'player-caller', isAlive: true, characterName: 'Caller' }]);
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

function setupActiveCall() {
  const call = {
    id: 'call-1',
    status: 'active',
    callerPlayerId: 'player-caller',
    recipientPlayerId: 'player-recipient',
    staffThreadId: 'staff-thread-1',
  };
  const participants = {
    call,
    callerPlayer: { id: 'player-caller', discordId: 'discord-caller', characterName: 'Caller' },
    recipientPlayer: { id: 'player-recipient', discordId: 'discord-recipient', characterName: 'Recipient' },
    callerNumber: { id: 'number-caller', numberRaw: '111' },
    recipientNumber: { id: 'number-recipient', numberRaw: '222' },
  };
  setupResolvedPlayer();
  mocks.svc.findOpenCallForPlayer.mockResolvedValue(call);
  mocks.svc.getCallParticipants.mockResolvedValue(participants);
  return { call, participants };
}

describe('messageCreate voicemail DM flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbRows.length = 0;
    clearNoCallCache('discord-caller');
    mocks.svc.recordMessage.mockResolvedValue({
      message: { id: 'message-1', content: 'call me back' },
      tapDeliveries: [],
    });
    mocks.svc.systemEndCall.mockResolvedValue({ id: 'call-1', status: 'ended' });
    mocks.svc.findOpenCallForPlayer.mockResolvedValue(null);
    mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'none' });
    mocks.textSvc.recordReply.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'text-message-1', content: 'hi' },
      delivery: { id: 'delivery-1' },
      tapDeliveries: [],
      sender: { playerId: 'player-caller' },
      recipient: { playerId: 'player-recipient' },
    });
    mocks.relayMessage.mockResolvedValue(undefined);
    mocks.relayRecordedPhoneText.mockResolvedValue(undefined);
    mocks.flushQueuedPhoneTextsForPlayer.mockResolvedValue(0);
    mocks.ticketAddMessage.mockResolvedValue({ id: 'ticket-message-1' });
    mocks.notifyTicketOwnerOfReply.mockResolvedValue(undefined);
    mocks.isStaff.mockResolvedValue(false);
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

describe('messageCreate phone text DM routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbRows.length = 0;
    clearNoCallCache('discord-caller');
    mocks.svc.findOpenCallForPlayer.mockResolvedValue(null);
    mocks.svc.recordMessage.mockResolvedValue({
      message: { id: 'message-1', content: 'call me back' },
      tapDeliveries: [],
    });
    mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'none' });
    mocks.textSvc.recordReply.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'text-message-1', content: 'hi' },
      delivery: { id: 'delivery-1' },
      tapDeliveries: [],
      sender: { playerId: 'player-caller' },
      recipient: { playerId: 'player-recipient' },
    });
    mocks.relayMessage.mockResolvedValue(undefined);
    mocks.relayRecordedPhoneText.mockResolvedValue(undefined);
    mocks.flushQueuedPhoneTextsForPlayer.mockResolvedValue(0);
  });

  it('still routes a text reply when the no-call negative cache is fresh', async () => {
    const { handler, client } = makeClient();
    setupResolvedPlayer();
    mocks.textSvc.resolveReplyConversation.mockResolvedValueOnce({ status: 'none' });

    await handler(makeMessage('first loose DM'));

    expect(mocks.svc.findOpenCallForPlayer).toHaveBeenCalledTimes(1);
    setupResolvedPlayer();
    mocks.textSvc.resolveReplyConversation.mockResolvedValueOnce({
      status: 'sole',
      context: { conversation: { id: 'conversation-1' } },
    });

    await handler(makeMessage('hi'));

    expect(mocks.svc.findOpenCallForPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.textSvc.recordReply).toHaveBeenCalledWith({
      senderPlayerId: 'player-caller',
      conversationId: 'conversation-1',
      content: 'hi',
      senderDiscordMessageId: 'discord-message-1',
    });
    expect(mocks.relayRecordedPhoneText).toHaveBeenCalledWith(client, expect.any(Object));
  });

  it('lets an active call own the DM instead of routing it as a text conversation reply', async () => {
    const { handler, client } = makeClient();
    const message = makeMessage('call message');
    const { participants } = setupActiveCall();

    await handler(message);

    expect(mocks.textSvc.resolveReplyConversation).not.toHaveBeenCalled();
    expect(mocks.svc.recordMessage).toHaveBeenCalledWith({
      callId: 'call-1',
      senderPlayerId: 'player-caller',
      content: 'call message',
      senderDiscordMessageId: 'discord-message-1',
    });
    expect(mocks.relayMessage).toHaveBeenCalledWith(client, participants, expect.any(Object), true);
  });

  it('records text typed in a ticket thread as a public ticket reply', async () => {
    const { handler } = makeClient();
    const content = "that's quite a few favours eh";
    mocks.dbRows.push([{
      id: 'ticket-42',
      number: 42,
      title: 'Missing thread messages',
      createdById: 'owner-player',
      assignedToId: null,
      discordThreadId: 'thread-42',
    }]);
    mocks.dbRows.push([{ id: 'player-caller' }]);
    mocks.isStaff.mockResolvedValueOnce(true);
    const message = makeThreadMessage(content);

    await handler(message);

    expect(mocks.ticketAddMessage).toHaveBeenCalledWith(
      'ticket-42',
      content,
      'player-caller',
      false,
      'discord-message-1',
      true,
      false,
    );
    expect(mocks.notifyTicketOwnerOfReply).toHaveBeenCalledWith({
      db: expect.any(Object),
      ticket: expect.objectContaining({
        id: 'ticket-42',
        number: 42,
        title: 'Missing thread messages',
        createdById: 'owner-player',
      }),
      authorId: 'player-caller',
      content,
    });
    expect(mocks.svc.findOpenCallForPlayer).not.toHaveBeenCalled();
    expect(mocks.textSvc.resolveReplyConversation).not.toHaveBeenCalled();
  });

  it('uses the author staff flag when a ticket thread message has no guild member payload', async () => {
    const { handler } = makeClient();
    mocks.dbRows.push([{
      id: 'ticket-42',
      number: 42,
      title: 'Missing thread messages',
      createdById: 'owner-player',
      assignedToId: null,
      discordThreadId: 'thread-42',
    }]);
    mocks.dbRows.push([{ id: 'staff-player', isStaff: true }]);
    const message = makeThreadMessage('staff reply with no member payload');
    message.member = null as any;

    await handler(message);

    expect(mocks.isStaff).not.toHaveBeenCalled();
    expect(mocks.ticketAddMessage).toHaveBeenCalledWith(
      'ticket-42',
      'staff reply with no member payload',
      'staff-player',
      false,
      'discord-message-1',
      true,
      false,
    );
  });

  it('records attachment-only ticket thread replies using the attachment URL', async () => {
    const { handler } = makeClient();
    mocks.dbRows.push([{
      id: 'ticket-42',
      number: 42,
      title: 'Missing thread messages',
      createdById: 'owner-player',
      assignedToId: null,
      discordThreadId: 'thread-42',
    }]);
    mocks.dbRows.push([{ id: 'staff-player', isStaff: true }]);
    const message = makeThreadMessage('   ');
    message.member = null as any;
    message.attachments = new Map([
      ['attachment-1', { name: 'receipt.png', url: 'https://cdn.discordapp.com/receipt.png' }],
    ]) as any;

    await handler(message);

    expect(mocks.ticketAddMessage).toHaveBeenCalledWith(
      'ticket-42',
      '**Attachments:**\n- receipt.png: https://cdn.discordapp.com/receipt.png',
      'staff-player',
      false,
      'discord-message-1',
      true,
      false,
    );
  });

  it('records sticker-only ticket thread replies using the sticker name', async () => {
    const { handler } = makeClient();
    mocks.dbRows.push([{
      id: 'ticket-42',
      number: 42,
      title: 'Missing thread messages',
      createdById: 'owner-player',
      assignedToId: null,
      discordThreadId: 'thread-42',
    }]);
    mocks.dbRows.push([{ id: 'staff-player', isStaff: true }]);
    const message = makeThreadMessage('');
    message.member = null as any;
    message.stickers = new Map([
      ['sticker-1', { name: 'thumbs up' }],
    ]) as any;

    await handler(message);

    expect(mocks.ticketAddMessage).toHaveBeenCalledWith(
      'ticket-42',
      '**Stickers:**\n- thumbs up',
      'staff-player',
      false,
      'discord-message-1',
      true,
      false,
    );
  });
});
