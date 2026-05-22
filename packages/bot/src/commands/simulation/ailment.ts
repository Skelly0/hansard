import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog, simulationClock } from '@hansard/db';
import { advanceDateByTicks } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { sendAilmentDmSafely } from '../../utils/ailmentNotifications.js';

async function ensureStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild || !interaction.member) {
    await interaction.editReply({
      embeds: [errorEmbed('This command must be used in a server.')],
    });
    return false;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff can manage ailments.')],
    });
    return false;
  }
  return true;
}

function getWorstSeverity(ailments: { severity: string }[]): string {
  if (ailments.some(a => a.severity === 'critical')) return 'critical';
  if (ailments.some(a => a.severity === 'major')) return 'major';
  if (ailments.some(a => a.severity === 'minor')) return 'minor';
  return 'healthy';
}

async function fetchClock() {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

type AilmentEntry = {
  condition: string;
  severity: 'minor' | 'major' | 'critical';
  acquiredAtTick: number;
  acquiredAtAge: number;
  durationYears?: number;
  healsAtDate?: string;
  notes?: string;
};

function buildRecoveryLine(ailment: AilmentEntry): string | null {
  if (!ailment.healsAtDate) return null;
  const durationText = ailment.durationYears
    ? ` after ${ailment.durationYears} year${ailment.durationYears === 1 ? '' : 's'}`
    : '';
  return `Expected recovery: ${ailment.healsAtDate}${durationText}`;
}

export async function executeAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  if (!(await ensureStaff(interaction))) return;

  const targetUser = interaction.options.getUser('user', true);
  const condition = interaction.options.getString('condition', true);
  const severity = interaction.options.getString('severity', true) as 'minor' | 'major' | 'critical';
  const durationYears = interaction.options.getInteger('duration-years') ?? undefined;

  if (durationYears !== undefined && (!Number.isInteger(durationYears) || durationYears < 1 || durationYears > 200)) {
    await interaction.editReply({ embeds: [errorEmbed('Recovery duration must be an integer between 1 and 200 years.')] });
    return;
  }

  const [targetPlayer] = await db.select().from(players)
    .where(eq(players.discordId, targetUser.id));

  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('That user is not registered as a player.')] });
    return;
  }

  if (!targetPlayer.isAlive) {
    await interaction.editReply({ embeds: [errorEmbed('Cannot assign ailments to a dead character.')] });
    return;
  }

  const [staffPlayer] = await db.select().from(players)
    .where(eq(players.discordId, interaction.user.id));

  const clock = await fetchClock();
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';
  let recoveryFields: Pick<AilmentEntry, 'durationYears' | 'healsAtDate'> = {};
  if (durationYears !== undefined) {
    if (!clock) {
      await interaction.editReply({
        embeds: [errorEmbed('Cannot schedule timed recovery without a simulation clock.')],
      });
      return;
    }

    try {
      recoveryFields = {
        durationYears,
        healsAtDate: advanceDateByTicks(clock.currentDate, durationYears, 'year'),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not calculate recovery date.';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }
  }

  const currentAilments = (targetPlayer.ailments ?? []) as AilmentEntry[];

  if (currentAilments.some(a => a.condition === condition)) {
    await interaction.editReply({ embeds: [errorEmbed(`Player already has ailment: ${condition}`)] });
    return;
  }

  const newAilment: AilmentEntry = {
    condition,
    severity,
    acquiredAtTick: currentTick,
    acquiredAtAge: targetPlayer.currentAge ?? 0,
    ...recoveryFields,
    notes: 'Manually assigned by staff',
  };

  const updatedAilments = [...currentAilments, newAilment];
  const worstSeverity = getWorstSeverity(updatedAilments);

  await db.update(players).set({
    ailments: updatedAilments,
    healthStatus: worstSeverity,
  }).where(eq(players.id, targetPlayer.id));

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'ailment_acquired',
    description: `Staff assigned ${severity} ailment: ${condition}${newAilment.healsAtDate ? `; expected recovery ${newAilment.healsAtDate}` : ''}`,
    newValue: newAilment,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: staffPlayer?.id ?? null,
    isAutomatic: false,
  });

  const severityEmoji = severity === 'critical' ? '☠️' : severity === 'major' ? '⚠️' : '🩹';
  const dmSent = await sendAilmentDmSafely({
    user: targetUser,
    characterName: targetPlayer.characterName,
    condition,
    severity,
  }, { playerId: targetPlayer.id });
  const recoveryLine = buildRecoveryLine(newAilment);

  const embed = createEmbed({
    title: 'Ailment Assigned',
    description: [
      `**${targetPlayer.characterName ?? targetUser.username}** has been afflicted with:`,
      '',
      `${severityEmoji} **${condition}** (${severity})`,
      ...(recoveryLine ? ['', recoveryLine] : []),
      '',
      dmSent ? 'DM sent to player.' : 'DM could not be delivered; check bot logs.',
    ].join('\n'),
    system: 'simulation',
    fields: [
      { name: 'Player', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Health Status', value: worstSeverity, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

export async function executeRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  if (!(await ensureStaff(interaction))) return;

  const targetUser = interaction.options.getUser('user', true);
  const condition = interaction.options.getString('condition', true);

  const [targetPlayer] = await db.select().from(players)
    .where(eq(players.discordId, targetUser.id));

  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('That user is not registered as a player.')] });
    return;
  }

  const [staffPlayer] = await db.select().from(players)
    .where(eq(players.discordId, interaction.user.id));

  const clock = await fetchClock();
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';

  const currentAilments = (targetPlayer.ailments ?? []) as AilmentEntry[];
  const ailmentIndex = currentAilments.findIndex(a => a.condition === condition);

  if (ailmentIndex === -1) {
    await interaction.editReply({ embeds: [errorEmbed(`Player does not have ailment: ${condition}`)] });
    return;
  }

  const removed = currentAilments[ailmentIndex]!;
  const updatedAilments = currentAilments.filter((_, i) => i !== ailmentIndex);
  const worstSeverity = updatedAilments.length > 0 ? getWorstSeverity(updatedAilments) : 'healthy';

  await db.update(players).set({
    ailments: updatedAilments,
    healthStatus: worstSeverity,
  }).where(eq(players.id, targetPlayer.id));

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'ailment_recovered',
    description: `Recovered from ${removed.severity} ailment: ${condition}`,
    oldValue: removed,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: staffPlayer?.id ?? null,
    isAutomatic: false,
  });

  const embed = successEmbed(
    'Ailment Removed',
    [
      `**${targetPlayer.characterName ?? targetUser.username}** has recovered from **${condition}**.`,
      '',
      `Health status: **${worstSeverity}**`,
    ].join('\n'),
  );

  await interaction.editReply({ embeds: [embed] });
}
