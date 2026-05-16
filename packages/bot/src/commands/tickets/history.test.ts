import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './history.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getTicketViewer: vi.fn(),
  getTicketByNumber: vi.fn(),
  createPaginatedEmbed: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/ticketAccess.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/ticketAccess.js')>('../../utils/ticketAccess.js');
  return {
    ...actual,
    getTicketViewer: mocks.getTicketViewer,
  };
});

vi.mock('@hansard/api/services/ticketService', () => ({
  TicketService: vi.fn(function TicketService() {
    return {
      getTicketByNumber: mocks.getTicketByNumber,
    };
  }),
}));

vi.mock('../../utils/pagination.js', () => ({
  createPaginatedEmbed: mocks.createPaginatedEmbed,
}));

const actor = {
  id: 'staff-player-id',
  discordId: 'staff-discord-id',
  discordUsername: 'Staffer',
  characterName: 'Staff Character',
};

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

function makeInteraction() {
  return {
    options: {
      getInteger: vi.fn().mockReturnValue(42),
    },
    user: {
      id: actor.discordId,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticket history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReturnValue(selectRows([actor]));
    mocks.getTicketViewer.mockResolvedValue({
      viewer: { userId: actor.id, isStaff: true },
      isStaff: true,
      playerId: actor.id,
    });
  });

  it('renders linked and unlinked audit rows in the full timeline', async () => {
    mocks.getTicketByNumber.mockResolvedValue({
      id: 'ticket-id',
      number: 42,
      title: 'Timeline completeness',
      messages: [],
      auditLog: [
        {
          id: 'audit-linked',
          ticketId: 'ticket-id',
          actorId: actor.id,
          action: 'linked',
          oldValue: null,
          newValue: { linkedTicketId: 'ticket-7' },
          createdAt: '2026-05-16T10:00:00.000Z',
        },
        {
          id: 'audit-unlinked',
          ticketId: 'ticket-id',
          actorId: actor.id,
          action: 'unlinked',
          oldValue: { linkedTicketId: 'ticket-7' },
          newValue: null,
          createdAt: '2026-05-16T10:05:00.000Z',
        },
      ],
    });

    await execute(makeInteraction() as any);

    expect(mocks.createPaginatedEmbed).toHaveBeenCalledTimes(1);
    const { pages } = mocks.createPaginatedEmbed.mock.calls[0][0];
    const description = pages[0].data.description ?? '';
    expect(description).toContain('linked another ticket');
    expect(description).toContain('unlinked another ticket');
    expect(description).toContain('2 events');
  });
});
