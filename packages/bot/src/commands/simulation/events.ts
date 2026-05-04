import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, gte, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import type { Command } from '../../client.js';

const PAGE_SIZE = 10;

const EVENT_TYPE_EMOJI: Record<string, string> = {
  registration: '\u{1F4DD}',
  party_change: '\u{1F3DB}\u{FE0F}',
  faction_change: '\u{2694}\u{FE0F}',
  office_appointed: '\u{1F451}',
  office_left: '\u{1F44B}',
  ailment_acquired: '\u{1FA7A}',
  ailment_recovered: '\u{1F49A}',
  health_changed: '\u{2764}\u{FE0F}',
  death: '\u{26B0}\u{FE0F}',
  name_change: '\u{1F4AC}',
  suspension: '\u{26D4}',
  unsuspension: '\u{2705}',
};

const TYPE_CHOICES = Object.values(PlayerEventType).map((value) => ({
  name: value.replace(/_/g, ' '),
  value,
})) as { name: string; value: string }[];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('sim-events')
    .setDescription('Show a global timeline of recent player events')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Filter by event type')
        .setRequired(false)
        .addChoices(...TYPE_CHOICES),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('Number of events (default 25, max 100)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addStringOption((opt) =>
      opt
        .setName('since')
        .setDescription('Sim date floor (e.g. 1925-06-01) — events on/after this date')
        .setRequired(false)
        .setMaxLength(32),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const eventType = interaction.options.getString('type');
    const limit = interaction.options.getInteger('limit') ?? 25;
    const since = interaction.options.getString('since')?.trim() || null;

    const conditions: SQL[] = [];
    if (eventType) conditions.push(eq(playerEventLog.eventType, eventType));
    if (since) conditions.push(gte(playerEventLog.simDate, since));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const events = await db
      .select({
        id: playerEventLog.id,
        playerId: playerEventLog.playerId,
        eventType: playerEventLog.eventType,
        description: playerEventLog.description,
        simDate: playerEventLog.simDate,
        isAutomatic: playerEventLog.isAutomatic,
        createdAt: playerEventLog.createdAt,
        characterName: players.characterName,
        discordId: players.discordId,
      })
      .from(playerEventLog)
      .leftJoin(players, eq(playerEventLog.playerId, players.id))
      .where(whereClause)
      .orderBy(desc(playerEventLog.createdAt))
      .limit(limit);

    if (events.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Sim Events',
            description: '*No matching events recorded.*',
            system: 'simulation',
          }),
        ],
      });
      return;
    }

    const lines = events.map((e) => {
      const emoji = EVENT_TYPE_EMOJI[e.eventType] ?? '\u{1F4C4}';
      const ts = e.createdAt
        ? `<t:${Math.floor(e.createdAt.getTime() / 1000)}:R>`
        : 'unknown';
      const sim = e.simDate ? ` *(${e.simDate})*` : '';
      const auto = e.isAutomatic ? ' \u{2699}\u{FE0F}' : '';
      const who = e.characterName ?? (e.discordId ? `<@${e.discordId}>` : '*unknown*');
      return `${emoji} **${e.eventType.replace(/_/g, ' ')}** — ${who} — ${ts}${sim}${auto}\n> ${e.description}`;
    });

    const filterParts: string[] = [];
    if (eventType) filterParts.push(`type=\`${eventType}\``);
    if (since) filterParts.push(`since=\`${since}\``);
    const filterLabel = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < lines.length; i += PAGE_SIZE) {
      const chunk = lines.slice(i, i + PAGE_SIZE);
      pages.push(
        createEmbed({
          title: 'Sim Events Timeline',
          description: `Showing **${events.length}** event${events.length === 1 ? '' : 's'}${filterLabel}.\n\n${chunk.join('\n\n')}`,
          system: 'simulation',
        }),
      );
    }

    await createPaginatedEmbed({ interaction, pages });
  },
};

export default command;
