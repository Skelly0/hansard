import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog, simulationClock } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

/**
 * Mirrors POST /api/simulation/heal (simulationService.heal).
 * Properly resolves an active ailment record on a player.
 *
 * NOTE: ailments are stored as a JSONB array on `players.ailments`. There is
 * no separate ailments table with a `resolvedAt` column, so resolution is
 * captured by the `ailment_recovered` entry in `playerEventLog` (with the
 * removed ailment in `oldValue`). The ailment is then removed from the array.
 *
 * This is functionally similar to `/character ailment-remove` but uses ilike
 * lookup and disambiguates on multiple matches.
 */

type AilmentEntry = {
  condition: string;
  severity: 'minor' | 'major' | 'critical';
  acquiredAtTick: number;
  acquiredAtAge: number;
  durationYears?: number;
  healsAtDate?: string;
  notes?: string;
};

function getWorstSeverity(ailments: { severity: string }[]): string {
  if (ailments.some((a) => a.severity === 'critical')) return 'critical';
  if (ailments.some((a) => a.severity === 'major')) return 'major';
  if (ailments.some((a) => a.severity === 'minor')) return 'minor';
  return 'healthy';
}

async function fetchClock() {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
      embeds: [errorEmbed('Only staff can heal players.')],
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const ailmentQuery = interaction.options.getString('ailment', true).trim();

  if (!ailmentQuery) {
    await interaction.editReply({
      embeds: [errorEmbed('Please provide an ailment name to look up.')],
    });
    return;
  }

  const [targetPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id));

  if (!targetPlayer) {
    await interaction.editReply({
      embeds: [errorEmbed('That user is not registered as a player.')],
    });
    return;
  }

  const currentAilments = (targetPlayer.ailments ?? []) as AilmentEntry[];

  if (currentAilments.length === 0) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `**${targetPlayer.characterName ?? targetUser.username}** has no active ailments.`,
        ),
      ],
    });
    return;
  }

  const needle = ailmentQuery.toLowerCase();
  const matches = currentAilments.filter((a) =>
    a.condition.toLowerCase().includes(needle),
  );

  if (matches.length === 0) {
    const available = currentAilments
      .map((a) => `• \`${a.condition}\` (${a.severity})`)
      .join('\n');
    await interaction.editReply({
      embeds: [
        errorEmbed(
          [
            `No active ailment matching \`${ailmentQuery}\` for **${targetPlayer.characterName ?? targetUser.username}**.`,
            '',
            '**Active ailments:**',
            available,
          ].join('\n'),
        ),
      ],
    });
    return;
  }

  if (matches.length > 1) {
    const list = matches
      .map((a) => `• \`${a.condition}\` (${a.severity})`)
      .join('\n');
    await interaction.editReply({
      embeds: [
        errorEmbed(
          [
            `Ambiguous: \`${ailmentQuery}\` matches multiple ailments. Please be more specific.`,
            '',
            '**Matches:**',
            list,
          ].join('\n'),
        ),
      ],
    });
    return;
  }

  const removed = matches[0]!;

  const [staffPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id));

  const clock = await fetchClock();
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';

  const updatedAilments = currentAilments.filter(
    (a) => a.condition !== removed.condition,
  );
  const worstSeverity =
    updatedAilments.length > 0 ? getWorstSeverity(updatedAilments) : 'healthy';

  await db
    .update(players)
    .set({
      ailments: updatedAilments,
      healthStatus: worstSeverity,
    })
    .where(eq(players.id, targetPlayer.id));

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'ailment_recovered',
    description: `Healed of ${removed.severity} ailment: ${removed.condition}`,
    oldValue: removed,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: staffPlayer?.id ?? null,
    isAutomatic: false,
  });

  const embed = successEmbed(
    'Ailment Healed',
    [
      `**${targetPlayer.characterName ?? targetUser.username}** has been cured of **${removed.condition}** (${removed.severity}).`,
      '',
      `Health status: **${worstSeverity}**`,
    ].join('\n'),
  );

  await interaction.editReply({ embeds: [embed] });
}
