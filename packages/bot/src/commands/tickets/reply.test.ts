import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './reply.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getTicketViewer: vi.fn(),
  getTicketByNumber: vi.fn(),
  addMessage: vi.fn(),
  usersFetch: vi.fn(),
  ownerSend: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/ticketAccess.js', () => ({
  getTicketViewer: mocks.getTicketViewer,
}));

vi.mock('@hansard/api/services/ticketService', () => ({
  TicketService: vi.fn(function TicketService() {
    return {
      getTicketByNumber: mocks.getTicketByNumber,
      addMessage: mocks.addMessage,
    };
  }),
}));

const authorPlayer = {
  id: 'staff-player-id',
  discordId: 'staff-discord-id',
  discordUsername: 'Staffer',
  characterName: 'Staff Character',
};

const ownerPlayer = {
  id: 'owner-player-id',
  discordId: 'owner-discord-id',
  discordUsername: 'TicketOwner',
  characterName: 'Owner Character',
};

const ticket = {
  id: 'ticket-id',
  number: 42,
  title: 'Missing thread messages',
  createdById: ownerPlayer.id,
  assignedToId: null,
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
      getString: vi.fn().mockReturnValue('Here is the public reply.'),
    },
    user: {
      id: authorPlayer.discordId,
      username: authorPlayer.discordUsername,
    },
    client: {
      users: {
        fetch: mocks.usersFetch,
      },
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ticket-reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select
      .mockImplementationOnce(() => selectLimit([authorPlayer]))
      .mockImplementationOnce(() => selectLimit([ownerPlayer]));
    mocks.getTicketViewer.mockResolvedValue({
      viewer: { userId: authorPlayer.id, isStaff: true },
      isStaff: true,
      playerId: authorPlayer.id,
    });
    mocks.getTicketByNumber.mockResolvedValue(ticket);
    mocks.addMessage.mockResolvedValue({
      id: 'ticket-message-id',
      ticketId: ticket.id,
      authorId: authorPlayer.id,
      content: 'Here is the public reply.',
      isInternal: false,
    });
    mocks.usersFetch.mockResolvedValue({ send: mocks.ownerSend });
    mocks.ownerSend.mockResolvedValue(undefined);
  });

  it('notifies the ticket owner by DM when a public reply is posted by someone else', async () => {
    const interaction = makeInteraction();

    await command.execute(interaction as any);

    expect(mocks.usersFetch).toHaveBeenCalledWith(ownerPlayer.discordId);
    expect(mocks.ownerSend).toHaveBeenCalledTimes(1);
    const payload = mocks.ownerSend.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toContain('Ticket #42');
    expect(payload.embeds[0].data.description).toContain('Here is the public reply.');
  });
});
