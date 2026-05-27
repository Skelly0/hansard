import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from './view.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getTicketViewer: vi.fn(),
  getTicketByNumber: vi.fn(),
  createPaginatedEmbed: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/ticketAccess.js', () => ({
  getTicketViewer: mocks.getTicketViewer,
}));

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

const creator = {
  id: 'owner-player-id',
  discordId: 'owner-discord-id',
  discordUsername: 'TicketOwner',
  characterName: 'Owner Character',
};

const ticket = {
  id: 'ticket-id',
  number: 42,
  title: 'Missing thread messages',
  description: 'Players should not see the staff thread.',
  category: { name: 'Appeals' },
  createdById: creator.id,
  assignedToId: null,
  status: 'open',
  priority: 'normal',
  tags: [],
  createdAt: '2026-05-22T15:28:00.000Z',
  discordThreadId: 'staff-thread-id',
};

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    options: {
      getInteger: vi.fn().mockReturnValue(42),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticket view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReturnValue(selectLimit([creator]));
    mocks.getTicketByNumber.mockResolvedValue(ticket);
  });

  it('hides the Discord thread field from non-staff viewers', async () => {
    mocks.getTicketViewer.mockResolvedValue({
      viewer: { userId: creator.id, isStaff: false },
      isStaff: false,
      playerId: creator.id,
    });

    await execute(makeInteraction() as any);

    const { pages } = mocks.createPaginatedEmbed.mock.calls[0][0];
    const fieldNames = pages.flatMap((page: { data: { fields?: { name: string }[] } }) =>
      page.data.fields?.map((field) => field.name) ?? [],
    );
    expect(fieldNames).not.toContain('Thread');
  });
});
