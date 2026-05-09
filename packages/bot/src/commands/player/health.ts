import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

const HEALTH_DISPLAY: Record<string, string> = {
  healthy: '\u{1F7E2} Healthy',
  minor: '\u{1F7E1} Minor Ailment',
  major: '\u{1F7E0} Major Ailment',
  critical: '\u{1F534} Critical',
  deceased: '\u{26B0}\u{FE0F} Deceased',
};

const SEVERITY_DISPLAY: Record<string, string> = {
  minor: '\u{1F7E1} minor',
  major: '\u{1F7E0} major',
  critical: '\u{1F534} critical',
};

interface AilmentEntry {
  condition: string;
  severity: 'minor' | 'major' | 'critical';
  acquiredAtTick: number;
  acquiredAtAge: number;
  notes?: string;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('player-health')
    .setDescription('Show a player\'s health and ailment status')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The player to inspect')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user', true);

    const [player] = await db
      .select()
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

    // Mirror getPlayerHealth: read current health/ailments from the player row,
    // plus health-related events from the event log.
    const ailments = (player.ailments as AilmentEntry[] | null) ?? [];

    const healthEventTypes = [
      PlayerEventType.AILMENT_ACQUIRED,
      PlayerEventType.AILMENT_RECOVERED,
      PlayerEventType.HEALTH_CHANGED,
      PlayerEventType.DEATH_PENDING,
      PlayerEventType.DEATH,
    ];

    const healthEvents = await db
      .select()
      .from(playerEventLog)
      .where(
        and(
          eq(playerEventLog.playerId, player.id),
          inArray(playerEventLog.eventType, healthEventTypes),
        ),
      )
      .orderBy(desc(playerEventLog.createdAt))
      .limit(5);

    const healthDisplay = HEALTH_DISPLAY[player.healthStatus] ?? player.healthStatus;

    const ailmentText = ailments.length > 0
      ? ailments
          .map((a) => {
            const sev = SEVERITY_DISPLAY[a.severity] ?? a.severity;
            const acquired = `acquired age ${a.acquiredAtAge} (tick ${a.acquiredAtTick})`;
            const notes = a.notes ? `\n  *${a.notes}*` : '';
            return `• **${a.condition}** — ${sev}, ${acquired}${notes}`;
          })
          .join('\n')
      : '*No active ailments.*';

    const eventLines = healthEvents.map((e) => {
      const ts = e.createdAt
        ? `<t:${Math.floor(e.createdAt.getTime() / 1000)}:R>`
        : 'unknown';
      return `• **${e.eventType.replace(/_/g, ' ')}** — ${ts}\n  > ${e.description}`;
    });

    const fields = [
      { name: 'Status', value: healthDisplay, inline: true },
      {
        name: 'Age',
        value: String(player.currentAge ?? player.startingAge ?? '?'),
        inline: true,
      },
      {
        name: 'Alive',
        value: player.isAlive ? '\u{1F7E2} Yes' : '\u{26B0}\u{FE0F} No',
        inline: true,
      },
      { name: `Active Ailments (${ailments.length})`, value: ailmentText },
    ];

    if (!player.isAlive && player.causeOfDeath) {
      fields.push({
        name: 'Cause of Death',
        value: player.causeOfDeath,
        inline: false,
      });
    }

    if (eventLines.length > 0) {
      fields.push({
        name: 'Recent Health Events',
        value: eventLines.join('\n\n'),
      });
    }

    const embed = createEmbed({
      title: `Health: ${player.characterName}`,
      system: 'players',
      thumbnail: player.characterPortraitUrl ?? undefined,
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
