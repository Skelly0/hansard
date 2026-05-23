import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';
import {
  installStaffActionReplyLogging,
  postGenericStaffCommandActionLog,
} from './staffCommandLog.js';

const mocks = vi.hoisted(() => ({
  hasStaffActionLogBeenPosted: vi.fn(),
  isStaff: vi.fn(),
  postStaffActionLog: vi.fn(),
}));

vi.mock('./permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('./modLog.js', () => ({
  hasStaffActionLogBeenPosted: mocks.hasStaffActionLogBeenPosted,
  postStaffActionLog: mocks.postStaffActionLog,
}));

function makeInteraction(
  commandName = 'bill',
  subcommand = 'npc-vote',
  data: unknown[] = [],
  group: string | null = null,
) {
  return {
    commandName,
    member: { roles: [] },
    options: {
      data,
      getSubcommandGroup: vi.fn().mockReturnValue(group),
      getSubcommand: vi.fn().mockReturnValue(subcommand),
    },
  };
}

describe('postGenericStaffCommandActionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasStaffActionLogBeenPosted.mockReturnValue(false);
    mocks.isStaff.mockResolvedValue(true);
  });

  it('posts a fallback mod log for successful mutating staff command families', async () => {
    const interaction = makeInteraction();

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        title: 'Staff Command Used',
        system: 'bills',
        fields: [{ name: 'Command', value: '/bill npc-vote', inline: true }],
      }),
    );
  });

  it('includes slash command option details in fallback mod logs', async () => {
    const interaction = makeInteraction('vote', 'create', [
      {
        name: 'create',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'title',
            type: ApplicationCommandOptionType.String,
            value: 'Confidence vote',
          },
          {
            name: 'days',
            type: ApplicationCommandOptionType.Integer,
            value: 3,
          },
          {
            name: 'channel',
            type: ApplicationCommandOptionType.Channel,
            value: '123456789012345678',
            channel: {
              id: '123456789012345678',
              toString: () => '<#123456789012345678>',
            },
          },
        ],
      },
    ]);

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        fields: expect.arrayContaining([
          {
            name: 'Details',
            value: [
              '`title`: "Confidence vote"',
              '`days`: 3',
              '`channel`: <#123456789012345678>',
            ].join('\n'),
          },
        ]),
      }),
    );
  });

  it('keeps audit-intended free-text details for ticket notes', async () => {
    const interaction = makeInteraction('ticket', 'note', [
      {
        name: 'note',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'number',
            type: ApplicationCommandOptionType.Integer,
            value: 42,
          },
          {
            name: 'message',
            type: ApplicationCommandOptionType.String,
            value: 'Escalated because the player supplied screenshots.',
          },
        ],
      },
    ]);

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        fields: expect.arrayContaining([
          {
            name: 'Details',
            value: [
              '`number`: 42',
              '`message`: "Escalated because the player supplied screenshots."',
            ].join('\n'),
          },
        ]),
      }),
    );
  });

  it('keeps audit-intended free-text details for phone tap revocation notes', async () => {
    const interaction = makeInteraction('phone', 'tap-revoke', [
      {
        name: 'admin',
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: 'tap-revoke',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'target-number',
                type: ApplicationCommandOptionType.String,
                value: '+15551234567',
              },
              {
                name: 'notes',
                type: ApplicationCommandOptionType.String,
                value: 'Investigation ended; preserving final audit context.',
              },
            ],
          },
        ],
      },
    ], 'admin');

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        fields: expect.arrayContaining([
          {
            name: 'Details',
            value: [
              '`target-number`: "+15551234567"',
              '`notes`: "Investigation ended; preserving final audit context."',
            ].join('\n'),
          },
        ]),
      }),
    );
  });

  it('still redacts bulky document body options', async () => {
    const interaction = makeInteraction('doc', 'edit', [
      {
        name: 'edit',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: 'slug',
            type: ApplicationCommandOptionType.String,
            value: 'policy-index',
          },
          {
            name: 'content',
            type: ApplicationCommandOptionType.String,
            value: '# Full document body\nDo not pour this into modlog.',
          },
        ],
      },
    ]);

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        fields: expect.arrayContaining([
          {
            name: 'Details',
            value: [
              '`slug`: "policy-index"',
              '`content`: [redacted]',
            ].join('\n'),
          },
        ]),
      }),
    );
  });

  it('skips commands that already posted a detailed staff action log', async () => {
    mocks.hasStaffActionLogBeenPosted.mockReturnValue(true);

    await postGenericStaffCommandActionLog(makeInteraction('favour', 'grant') as any);

    expect(mocks.postStaffActionLog).not.toHaveBeenCalled();
  });

  it('logs before a success editReply so reply failures do not hide committed actions', async () => {
    const editReply = vi.fn().mockRejectedValue(new Error('Discord reply failed'));
    const interaction = {
      ...makeInteraction(),
      editReply,
    };

    installStaffActionReplyLogging(interaction as any);

    await expect(interaction.editReply({
      embeds: [{
        toJSON: () => ({ title: 'NPC House Vote: PASSED' }),
      }],
    } as any)).rejects.toThrow('Discord reply failed');

    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(mocks.postStaffActionLog.mock.invocationCallOrder[0])
      .toBeLessThan(editReply.mock.invocationCallOrder[0]);
  });

  it('does not log error replies for fallback-listed staff commands', async () => {
    const interaction = {
      ...makeInteraction(),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    installStaffActionReplyLogging(interaction as any);
    await interaction.editReply({
      embeds: [{
        toJSON: () => ({ title: '❌ Error' }),
      }],
    } as any);

    expect(mocks.postStaffActionLog).not.toHaveBeenCalled();
  });

  it('adds the ticket command success summary to fallback mod logs', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      ...makeInteraction('ticket', 'close', [
        {
          name: 'close',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'number',
              type: ApplicationCommandOptionType.Integer,
              value: 42,
            },
            {
              name: 'reason',
              type: ApplicationCommandOptionType.String,
              value: 'Resolved after staff review.',
            },
          ],
        },
      ]),
      editReply,
    };

    installStaffActionReplyLogging(interaction as any);
    await interaction.editReply({
      embeds: [{
        toJSON: () => ({
          title: '✅ Ticket Closed',
          description: [
            '**Ticket:** #42 — Missing thread messages',
            '**Closed by:** <@staff-discord-id>',
            '**Resolution:** Resolved after staff review.',
          ].join('\n'),
        }),
      }],
    } as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        fields: expect.arrayContaining([
          {
            name: 'Result',
            value: [
              '**Ticket:** #42 — Missing thread messages',
              '**Closed by:** <@staff-discord-id>',
              '**Resolution:** Resolved after staff review.',
            ].join('\n'),
          },
        ]),
      }),
    );
  });
});
