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
