import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../client.js';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { postModLog } from '../utils/modLog.js';
import { isStaff } from '../utils/permissions.js';

const POSTABLE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
] as const;

type PostableChannel = {
  id: string;
  isTextBased: () => boolean;
  send: (options: {
    content: string;
    allowedMentions: { parse: Array<'users' | 'roles' | 'everyone'> };
  }) => Promise<{ url?: string | null }>;
  toString?: () => string;
  type: ChannelType;
};

function isPostableChannel(channel: unknown): channel is PostableChannel {
  if (!channel || typeof channel !== 'object') return false;
  const candidate = channel as Partial<PostableChannel>;
  return (
    typeof candidate.isTextBased === 'function'
    && candidate.isTextBased()
    && typeof candidate.send === 'function'
    && POSTABLE_CHANNEL_TYPES.includes(candidate.type as (typeof POSTABLE_CHANNEL_TYPES)[number])
  );
}

function channelLabel(channel: Pick<PostableChannel, 'id' | 'toString'>): string {
  return typeof channel.toString === 'function' ? channel.toString() : `<#${channel.id}>`;
}

function truncateField(value: string): string {
  return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post a bot message to a channel or thread (staff only)')
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('Message text to post')
        .setRequired(true)
        .setMaxLength(2000),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel or thread to post in; defaults to here')
        .setRequired(false)
        .addChannelTypes(...POSTABLE_CHANNEL_TYPES),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({
        embeds: [errorEmbed('This command must be used in a server.')],
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaff(member))) {
      await interaction.editReply({
        embeds: [errorEmbed('You do not have permission to post as the bot.')],
      });
      return;
    }

    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!isPostableChannel(target)) {
      await interaction.editReply({
        embeds: [
          errorEmbed('Choose a text channel/thread or run this command from one.'),
        ],
      });
      return;
    }

    const content = interaction.options.getString('text', true);

    let sent: { url?: string | null };
    try {
      sent = await target.send({
        content,
        allowedMentions: { parse: ['users', 'roles', 'everyone'] },
      });
    } catch (err) {
      console.error(`[post:cmd] failed to post to channel ${target.id}:`, err);
      await interaction.editReply({
        embeds: [
          errorEmbed(
            'I could not send a message there. Check that I can view the channel and send messages in it.',
          ),
        ],
      });
      return;
    }

    const linkLine = sent.url ? `\n\n${sent.url}` : '';
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Message posted',
          `Posted in ${channelLabel(target)}.${linkLine}`,
        ),
      ],
    });

    try {
      await postModLog(
        interaction,
        createEmbed({
          title: 'Bot Message Posted',
          system: 'moderation',
          fields: [
            { name: 'Actor', value: interaction.user.toString(), inline: true },
            { name: 'Target', value: channelLabel(target), inline: true },
            { name: 'Message', value: sent.url ?? 'Message sent; no URL returned.', inline: false },
            { name: 'Content', value: truncateField(content), inline: false },
          ],
        }),
      );
    } catch (err) {
      console.error('[post:cmd] failed to write audit log:', err);
    }
  },
};

export default command;
export const __testables = { isPostableChannel };
