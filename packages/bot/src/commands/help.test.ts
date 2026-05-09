import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, type Command } from '../client.js';
import helpCommand from './help.js';

const mocks = vi.hoisted(() => ({
  isStaff: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

function makeCommand(name: string, description: string, staffOnly = false): Command {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description);

  if (staffOnly) {
    builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  }

  return {
    data: builder as SlashCommandBuilder,
    execute: async () => {},
  };
}

function fakeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
    },
    user: { id: 'user-1' },
    member: { id: 'member-1' },
  } as any;
}

function renderedHelpText(interaction: ReturnType<typeof fakeInteraction>) {
  const firstReply = interaction.editReply.mock.calls[0]?.[0];
  const firstEmbed = firstReply.embeds[0];
  const fields = firstEmbed.data.fields ?? [];
  const overflow = interaction.followUp.mock.calls.flatMap((call: any[]) => {
    const embed = call[0].embeds[0];
    return embed.data.fields ?? [];
  });

  return [...fields, ...overflow].map((field: any) => field.value).join('\n');
}

describe('/help', () => {
  beforeEach(() => {
    commands.clear();
    vi.clearAllMocks();
  });

  it('hides staff-only command names from non-staff users', async () => {
    mocks.isStaff.mockResolvedValue(false);
    commands.set('ping', makeCommand('ping', 'Check whether the bot is awake'));
    commands.set('mod', makeCommand('mod', 'Moderation commands (staff only)', true));

    const interaction = fakeInteraction();
    await helpCommand.execute(interaction);

    const text = renderedHelpText(interaction);
    expect(text).toContain('/ping');
    expect(text).not.toContain('/mod');
    expect(text).not.toContain('Moderation commands');
  });

  it('shows staff-only command names to staff users', async () => {
    mocks.isStaff.mockResolvedValue(true);
    commands.set('ping', makeCommand('ping', 'Check whether the bot is awake'));
    commands.set('mod', makeCommand('mod', 'Moderation commands (staff only)', true));

    const interaction = fakeInteraction();
    await helpCommand.execute(interaction);

    const text = renderedHelpText(interaction);
    expect(text).toContain('/ping');
    expect(text).toContain('/mod');
  });
});
