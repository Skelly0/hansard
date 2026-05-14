import { beforeEach, describe, expect, it, vi } from 'vitest';

const ticketServiceMocks = vi.hoisted(() => ({
  listTickets: vi.fn(),
}));

vi.mock('@hansard/api/services/ticketService', () => ({
  TicketService: vi.fn(function TicketService() {
    return {
      listTickets: ticketServiceMocks.listTickets,
    };
  }),
}));

const phoneServiceMocks = vi.hoisted(() => ({
  listMyNumbers: vi.fn(),
  getCallHistory: vi.fn(),
  getCallTranscript: vi.fn(),
}));

vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(function PhoneService() {
    return {
      listMyNumbers: phoneServiceMocks.listMyNumbers,
      getCallHistory: phoneServiceMocks.getCallHistory,
      getCallTranscript: phoneServiceMocks.getCallTranscript,
    };
  }),
}));

import { registerAllTools } from './register.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function createServer() {
  const tools = new Map<string, { config: unknown; handler: (args: unknown) => Promise<unknown> }>();

  return {
    server: {
      registerTool: vi.fn((name: string, config: unknown, handler: (args: unknown) => Promise<unknown>) => {
        tools.set(name, { config, handler });
      }),
    },
    tools,
  };
}

describe('MCP ticket tools', () => {
  it('registers list_tickets and lists visible tickets for the authenticated session', async () => {
    ticketServiceMocks.listTickets.mockResolvedValue({
      tickets: [{ id: 'ticket-1', title: 'Missing cabinet papers' }],
      total: 1,
    });
    const { server, tools } = createServer();
    const session = {
      playerId: '00000000-0000-4000-8000-000000000001',
      discordId: '123',
      username: 'clerk',
      characterName: 'The Clerk',
      isStaff: false,
      staffRole: null,
      permissions: [],
    };

    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const tool = tools.get('list_tickets');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      status: 'open',
      priority: 'high',
      categoryId: '00000000-0000-4000-8000-000000000010',
      assignedToId: '00000000-0000-4000-8000-000000000011',
      createdById: '00000000-0000-4000-8000-000000000012',
      search: 'cabinet',
      limit: 10,
      offset: 5,
    });

    expect(ticketServiceMocks.listTickets).toHaveBeenCalledWith(
      {
        status: 'open',
        priority: 'high',
        categoryId: '00000000-0000-4000-8000-000000000010',
        assignedToId: '00000000-0000-4000-8000-000000000011',
        createdById: '00000000-0000-4000-8000-000000000012',
        search: 'cabinet',
        limit: 10,
        offset: 5,
      },
      { userId: session.playerId, isStaff: false },
    );
    expect(result).toMatchObject({
      content: [{ type: 'text' }],
    });
    expect(JSON.parse((result as { content: [{ text: string }] }).content[0].text)).toEqual({
      count: 1,
      total: 1,
      tickets: [{ id: 'ticket-1', title: 'Missing cabinet papers' }],
    });
  });
});

describe('MCP phone tools', () => {
  const session = {
    playerId: '00000000-0000-4000-8000-000000000001',
    discordId: '123',
    username: 'clerk',
    characterName: 'The Clerk',
    isStaff: false,
    staffRole: null,
    permissions: [],
  };

  it('exposes list_my_phone_numbers scoped to the authenticated player', async () => {
    phoneServiceMocks.listMyNumbers.mockResolvedValue([
      { id: 'num-1', numberRaw: '+15550142', isActive: true },
    ]);
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const tool = tools.get('list_my_phone_numbers');
    expect(tool).toBeDefined();
    const result = await tool!.handler({});

    expect(phoneServiceMocks.listMyNumbers).toHaveBeenCalledWith(session.playerId);
    expect(JSON.parse((result as { content: [{ text: string }] }).content[0].text)).toEqual({
      count: 1,
      numbers: [{ id: 'num-1', numberRaw: '+15550142', isActive: true }],
    });
  });

  it('passes viewer context to get_phone_call_history', async () => {
    phoneServiceMocks.getCallHistory.mockResolvedValue({ calls: [], total: 0 });
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const tool = tools.get('get_phone_call_history');
    expect(tool).toBeDefined();
    await tool!.handler({ playerId: session.playerId, limit: 10, offset: 0 });

    expect(phoneServiceMocks.getCallHistory).toHaveBeenCalledWith(
      session.playerId,
      { userId: session.playerId, isStaff: false },
      { limit: 10, offset: 0 },
    );
  });

  it('redacts internal Discord/staff IDs from non-staff call history results', async () => {
    phoneServiceMocks.getCallHistory.mockResolvedValue({
      calls: [{
        id: 'call-1',
        status: 'ended',
        callerPlayerId: session.playerId,
        recipientPlayerId: '00000000-0000-4000-8000-000000000002',
        ringDiscordMessageId: 'ring-msg',
        staffThreadId: 'staff-thread',
        forceEndedById: 'staff-player',
      }],
      total: 1,
    });
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const result = await tools.get('get_phone_call_history')!.handler({
      playerId: session.playerId,
      limit: 10,
      offset: 0,
    });

    const payload = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(payload.calls[0]).toMatchObject({ id: 'call-1', status: 'ended' });
    expect(payload.calls[0]).not.toHaveProperty('ringDiscordMessageId');
    expect(payload.calls[0]).not.toHaveProperty('staffThreadId');
    expect(payload.calls[0]).not.toHaveProperty('forceEndedById');
  });

  it('forwards transcript lookups with viewer context', async () => {
    phoneServiceMocks.getCallTranscript.mockResolvedValue({
      call: { id: 'call-1' },
      messages: [],
    });
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const tool = tools.get('get_phone_call_transcript');
    expect(tool).toBeDefined();
    await tool!.handler({ callId: '00000000-0000-4000-8000-00000000aaaa' });

    expect(phoneServiceMocks.getCallTranscript).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-00000000aaaa',
      { userId: session.playerId, isStaff: false },
    );
  });

  it('redacts transcript internals and tap audit rows for non-staff sessions', async () => {
    phoneServiceMocks.getCallTranscript.mockResolvedValue({
      call: {
        id: 'call-1',
        status: 'ended',
        ringDiscordMessageId: 'ring-msg',
        staffThreadId: 'staff-thread',
        forceEndedById: 'staff-player',
      },
      messages: [{
        id: 'msg-1',
        content: 'hello',
        senderDiscordMessageId: 'source-msg',
        recipientDiscordMessageId: 'copy-msg',
        staffMirrorMessageId: 'mirror-msg',
      }],
      taps: [{ id: 'delivery-1', tapId: 'tap-1', mirrorMessageId: 'tap-msg' }],
    });
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });

    const result = await tools.get('get_phone_call_transcript')!.handler({
      callId: '00000000-0000-4000-8000-00000000aaaa',
    });

    const payload = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(payload.call).toMatchObject({ id: 'call-1', status: 'ended' });
    expect(payload.call).not.toHaveProperty('ringDiscordMessageId');
    expect(payload.call).not.toHaveProperty('staffThreadId');
    expect(payload.call).not.toHaveProperty('forceEndedById');
    expect(payload.messages[0]).toMatchObject({ id: 'msg-1', content: 'hello' });
    expect(payload.messages[0]).not.toHaveProperty('senderDiscordMessageId');
    expect(payload.messages[0]).not.toHaveProperty('recipientDiscordMessageId');
    expect(payload.messages[0]).not.toHaveProperty('staffMirrorMessageId');
    expect(payload).not.toHaveProperty('taps');
  });

  it('preserves phone transcript internals for staff sessions', async () => {
    const staffSession = { ...session, isStaff: true };
    phoneServiceMocks.getCallTranscript.mockResolvedValue({
      call: {
        id: 'call-1',
        status: 'ended',
        ringDiscordMessageId: 'ring-msg',
        staffThreadId: 'staff-thread',
        forceEndedById: 'staff-player',
      },
      messages: [{
        id: 'msg-1',
        content: 'hello',
        senderDiscordMessageId: 'source-msg',
        recipientDiscordMessageId: 'copy-msg',
        staffMirrorMessageId: 'mirror-msg',
      }],
      taps: [{ id: 'delivery-1', tapId: 'tap-1', mirrorMessageId: 'tap-msg' }],
    });
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(staffSession) } as never,
    });

    const result = await tools.get('get_phone_call_transcript')!.handler({
      callId: '00000000-0000-4000-8000-00000000aaaa',
    });

    const payload = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(payload.call.ringDiscordMessageId).toBe('ring-msg');
    expect(payload.messages[0].staffMirrorMessageId).toBe('mirror-msg');
    expect(payload.taps[0].mirrorMessageId).toBe('tap-msg');
  });

  it('returns an empty payload when getCallTranscript yields null (call not found)', async () => {
    phoneServiceMocks.getCallTranscript.mockResolvedValue(null);
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });
    const tool = tools.get('get_phone_call_transcript');
    const result = await tool!.handler({ callId: '00000000-0000-4000-8000-00000000aaaa' });
    const payload = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(payload).toEqual({ call: null, messages: [] });
  });

  it('surfaces forbidden errors from the service as structured MCP errors', async () => {
    const forbidden = Object.assign(new Error('You can only view your own call history.'), {
      name: 'PhoneServiceError',
      code: 'forbidden',
    });
    phoneServiceMocks.getCallHistory.mockRejectedValue(forbidden);
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(session) } as never,
    });
    const tool = tools.get('get_phone_call_history');
    const result = await tool!.handler({ playerId: '00000000-0000-4000-8000-000000000002', limit: 10, offset: 0 });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result as { content: [{ text: string }] }).content[0].text).toContain('only view your own');
  });

  it('passes isStaff: true through to the service for staff sessions', async () => {
    phoneServiceMocks.getCallHistory.mockResolvedValue({ calls: [], total: 0 });
    const staffSession = { ...session, isStaff: true };
    const { server, tools } = createServer();
    registerAllTools(server as never, {
      db: {} as never,
      session: { get: vi.fn().mockResolvedValue(staffSession) } as never,
    });
    const tool = tools.get('get_phone_call_history');
    await tool!.handler({ playerId: '00000000-0000-4000-8000-000000000099', limit: 5, offset: 0 });
    expect(phoneServiceMocks.getCallHistory).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000099',
      { userId: staffSession.playerId, isStaff: true },
      { limit: 5, offset: 0 },
    );
  });
});
