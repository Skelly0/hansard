import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

const EVENT_LIMIT = 10;

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

// Build slash-command choices from the PlayerEventType enum so they stay in sync.
const TYPE_CHOICES = Object.values(PlayerEventType).map((value) => ({
  name: value.replace(/_/g, ' '),
  value,
})) as { name: string; value: string }[];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('player-events')
    .setDescription('Show recent events from a player\'s log')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The player to look up')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Filter by event type (optional)')
        .setRequired(false)
        .addChoices(...TYPE_CHOICES),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user', true);
    const eventType = interaction.options.getString('type');

    const [player] = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        characterPortraitUrl: players.characterPortraitUrl,
      })
      .from(players)
      .where(eq(players.discordId, targetUser.id))
      .limit(1);

    if (!player || !player.characterName) {
      await interaction.editReply({
        embeds: [
          errorEmbed(`**${targetUser.displayName}** has not registered a character yet.`),
        ],
      });
      return;
    }

    const conditions: SQL[] = [eq(playerEventLog.playerId, player.id)];
    if (eventType) {
      conditions.push(eq(playerEventLog.eventType, eventType));
    }

    const events = await db
      .select()
      .from(playerEventLog)
      .where(and(...conditions))
      .orderBy(desc(playerEventLog.createdAt))
      .limit(EVENT_LIMIT);

    if (events.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: `Events: ${player.characterName}`,
            description: eventType
              ? `*No \`${eventType}\` events recorded.*`
              : '*No events recorded yet.*',
            system: 'players',
          }),
        ],
      });
      return;
    }

    const lines = events.map((event) => {
      const emoji = EVENT_TYPE_EMOJI[event.eventType] ?? '\u{1F4C4}';
      const ts = event.createdAt
        ? `<t:${Math.floor(event.createdAt.getTime() / 1000)}:R>`
        : 'unknown';
      const simDate = event.simDate ? ` (Sim: ${event.simDate})` : '';
      const auto = event.isAutomatic ? ' *(auto)*' : '';
      return `${emoji} **${event.eventType.replace(/_/g, ' ')}** — ${ts}${simDate}${auto}\n> ${event.description}`;
    });

    const embed = createEmbed({
      title: `Events: ${player.characterName}`,
      description: lines.join('\n\n'),
      system: 'players',
      thumbnail: player.characterPortraitUrl ?? undefined,
      fields: [
        {
          name: 'Showing',
          value: `Last ${events.length}${eventType ? ` \`${eventType}\`` : ''} event${events.length === 1 ? '' : 's'}`,
          inline: true,
        },
      ],
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
