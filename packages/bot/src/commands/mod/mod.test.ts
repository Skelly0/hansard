import { beforeEach, describe, expect, it, vi } from 'vitest';
import modCommand from './mod.js';

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertResults: unknown[][] = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertResults.shift() ?? [])),
      })),
    })),
  };

  return {
    db,
    insertResults,
    isStaff: vi.fn(),
    selectResults,
  };
});

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

function fakeWarnInteraction() {
  const logChannelSend = vi.fn().mockResolvedValue(undefined);
  const channelsFetch = vi.fn().mockResolvedValue({ send: logChannelSend });
  const targetUserSend = vi.fn().mockResolvedValue(undefined);

  return {
    channelsFetch,
    interaction: {
      client: {
        channels: {
          fetch: channelsFetch,
        },
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({ id: 'staff-member-1' }),
        },
      },
      member: { id: 'staff-member-1' },
      options: {
        getSubcommand: vi.fn().mockReturnValue('warn'),
        getString: vi.fn().mockReturnValue('Crossed the line'),
        getUser: vi.fn().mockReturnValue({
          id: 'target-discord-id',
          send: targetUserSend,
          toString: () => '<@target-discord-id>',
          username: 'TargetUser',
        }),
      },
      user: {
        id: 'moderator-discord-id',
        toString: () => '<@moderator-discord-id>',
        username: 'ModUser',
      },
    } as any,
    logChannelSend,
    targetUserSend,
  };
}

describe('/mod warn modlog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.insertResults.length = 0;
    mocks.isStaff.mockResolvedValue(true);
    process.env.MOD_LOG_CHANNEL_ID = 'mod-log-channel-id';
  });

  it('posts created moderation actions to MOD_LOG_CHANNEL_ID when configured', async () => {
    mocks.selectResults.push(
      [{ id: 'target-player-id', characterName: 'Alex Mercer', isActive: true }],
      [{ id: 'moderator-player-id' }],
    );
    mocks.insertResults.push([
      {
        id: 'action-id',
        type: 'formal_warning',
        createdAt: new Date('2026-05-09T12:00:00Z'),
      },
    ]);

    const { channelsFetch, interaction, logChannelSend } = fakeWarnInteraction();

    await modCommand.execute(interaction);

    expect(channelsFetch).toHaveBeenCalledWith('mod-log-channel-id');
    expect(logChannelSend).toHaveBeenCalledTimes(1);
    const payload = logChannelSend.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toContain('Warning Issued');
    expect(payload.embeds[0].data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Action ID', value: '`action-id`' }),
      ]),
    );
  });
});
