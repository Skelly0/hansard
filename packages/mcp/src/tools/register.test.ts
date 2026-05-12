import { describe, expect, it, vi } from 'vitest';

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
});
