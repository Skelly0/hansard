import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { createEmbed, type EmbedField, type System } from './embeds.js';

const MOD_LOG_CHANNEL_ENV = 'MOD_LOG_CHANNEL_ID';
const staffActionLoggedInteractions = new WeakSet<ChatInputCommandInteraction>();

type SendableChannel = {
  send: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

export async function postModLog(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  const channelId = process.env[MOD_LOG_CHANNEL_ENV]?.trim();
  if (!channelId) return;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      console.error(`MOD_LOG_CHANNEL_ID ${channelId} did not resolve to a sendable channel.`);
      return;
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post moderation log:', err);
  }
}

export type StaffActionLogOptions = {
  title: string;
  description?: string;
  system?: System;
  fields?: EmbedField[];
};

function userLabel(interaction: ChatInputCommandInteraction): string {
  return typeof interaction.user.toString === 'function'
    ? interaction.user.toString()
    : `<@${interaction.user.id}>`;
}

export async function postStaffActionLog(
  interaction: ChatInputCommandInteraction,
  options: StaffActionLogOptions,
): Promise<void> {
  staffActionLoggedInteractions.add(interaction);

  try {
    const fields: EmbedField[] = [
      { name: 'Actor', value: userLabel(interaction), inline: true },
      ...(options.fields ?? []),
    ];

    await postModLog(
      interaction,
      createEmbed({
        title: options.title,
        description: options.description,
        system: options.system ?? 'moderation',
        fields,
      }),
    );
  } catch (err) {
    console.error('Failed to build staff action log:', err);
  }
}

export function hasStaffActionLogBeenPosted(interaction: ChatInputCommandInteraction): boolean {
  return staffActionLoggedInteractions.has(interaction);
}
