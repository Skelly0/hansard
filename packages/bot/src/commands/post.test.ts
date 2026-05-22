import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import postCommand from './post.js';

const mocks = vi.hoisted(() => ({
  isStaff: vi.fn(),
  postModLog: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('../utils/modLog.js', () => ({
  postModLog: mocks.postModLog,
}));

function makeInteraction({
  channel,
  currentChannel = channel,
  text = 'Council convenes now, <@123> <@&456> @everyone.',
}: {
  channel?: unknown;
  currentChannel?: unknown;
  text?: string;
} = {}) {
  return {
    channel: currentChannel,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ id: 'staff-member' }),
      },
    },
    member: { id: 'staff-member' },
    options: {
      getChannel: vi.fn().mockReturnValue(channel ?? null),
      getString: vi.fn().mockReturnValue(text),
    },
    user: {
      id: 'staff-discord-id',
      toString: () => '<@staff-discord-id>',
    },
  } as any;
}

function makeSendableChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-channel-id',
    isTextBased: () => true,
    send: vi.fn().mockResolvedValue({
      id: 'sent-message-id',
      url: 'https://discord.com/channels/guild-id/target-channel-id/sent-message-id',
    }),
    toString: () => '<#target-channel-id>',
    type: ChannelType.GuildText,
    ...overrides,
  };
}

describe('/post command definition', () => {
  it('accepts required post text and an optional text channel or thread', () => {
    const json = postCommand.data.toJSON();

    expect(json.name).toBe('post');
    expect(json.description).toMatch(/staff only/i);
    expect(json.options?.map((option) => option.name)).toEqual(['text', 'channel']);

    const textOption = json.options?.find((option) => option.name === 'text');
    expect(textOption).toMatchObject({
      name: 'text',
      required: true,
      max_length: 2000,
    });

    const channelOption = json.options?.find((option) => option.name === 'channel');
    expect(channelOption).toMatchObject({
      name: 'channel',
      required: false,
      channel_types: [
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
      ],
    });
  });
});

describe('/post execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff.mockResolvedValue(true);
  });

  it('refuses non-staff users without posting to the channel', async () => {
    mocks.isStaff.mockResolvedValue(false);
    const channel = makeSendableChannel();
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ data: expect.objectContaining({ title: '❌ Error' }) })],
    });
  });

  it('posts the exact text with user, role, and everyone mentions enabled', async () => {
    const channel = makeSendableChannel();
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(channel.send).toHaveBeenCalledWith({
      content: 'Council convenes now, <@123> <@&456> @everyone.',
      allowedMentions: { parse: ['users', 'roles', 'everyone'] },
    });

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining(
              'https://discord.com/channels/guild-id/target-channel-id/sent-message-id',
            ),
          }),
        }),
      ],
    });
  });

  it('posts in the current channel when no channel option is provided', async () => {
    const currentChannel = makeSendableChannel({
      id: 'current-thread-id',
      toString: () => '<#current-thread-id>',
      type: ChannelType.PublicThread,
    });
    const interaction = makeInteraction({ channel: null, currentChannel });

    await postCommand.execute(interaction);

    expect(interaction.options.getChannel).toHaveBeenCalledWith('channel');
    expect(currentChannel.send).toHaveBeenCalledWith({
      content: 'Council convenes now, <@123> <@&456> @everyone.',
      allowedMentions: { parse: ['users', 'roles', 'everyone'] },
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('<#current-thread-id>'),
          }),
        }),
      ],
    });
  });

  it('writes a best-effort mod log for successful bot-authored posts', async () => {
    const channel = makeSendableChannel();
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(mocks.postModLog).toHaveBeenCalledTimes(1);
    expect(mocks.postModLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.stringContaining('Bot Message Posted'),
          fields: expect.arrayContaining([
            expect.objectContaining({ name: 'Target', value: '<#target-channel-id>' }),
            expect.objectContaining({
              name: 'Message',
              value: 'https://discord.com/channels/guild-id/target-channel-id/sent-message-id',
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects non-sendable channels even if Discord somehow supplies one', async () => {
    const channel = {
      id: 'voice-channel-id',
      isTextBased: () => false,
      send: vi.fn(),
      type: ChannelType.GuildVoice,
    };
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({ data: expect.objectContaining({ title: '❌ Error' }) })],
    });
  });

  it('reports send failures without claiming the post succeeded', async () => {
    const channel = makeSendableChannel({
      send: vi.fn().mockRejectedValue(new Error('Missing permissions')),
    });
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('I could not send a message there'),
            title: '❌ Error',
          }),
        }),
      ],
    });
  });

  it('keeps the success confirmation even if audit logging unexpectedly fails', async () => {
    mocks.postModLog.mockRejectedValueOnce(new Error('log unavailable'));
    const channel = makeSendableChannel();
    const interaction = makeInteraction({ channel });

    await postCommand.execute(interaction);

    expect(channel.send).toHaveBeenCalledTimes(1);
    const editCalls = interaction.editReply.mock.calls;
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0][0]).toEqual({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ Message posted',
          }),
        }),
      ],
    });
  });
});
