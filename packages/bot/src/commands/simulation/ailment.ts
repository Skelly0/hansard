import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog, simulationClock } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

// ============================================================
// Helpers
// ============================================================

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
  notes?: string;
};

// ============================================================
// Command
// ============================================================

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ailment')
    .setDescription('Manage player ailments')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Give a player an ailment')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('condition').setDescription('Ailment name (e.g. gout, tuberculosis)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('severity')
            .setDescription('Ailment severity')
            .setRequired(true)
            .addChoices(
              { name: 'Minor', value: 'minor' },
              { name: 'Major', value: 'major' },
              { name: 'Critical', value: 'critical' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Cure a player\'s ailment')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('condition').setDescription('Ailment to remove').setRequired(true),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'add': await handleAdd(interaction); break;
      case 'remove': await handleRemove(interaction); break;
    }
  },
};

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user', true);
  const condition = interaction.options.getString('condition', true);
  const severity = interaction.options.getString('severity', true) as 'minor' | 'major' | 'critical';

  // Look up target player
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

  // Look up staff player for triggeredById
  const [staffPlayer] = await db.select().from(players)
    .where(eq(players.discordId, interaction.user.id));

  const clock = await fetchClock();
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';

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
    description: `Staff assigned ${severity} ailment: ${condition}`,
    newValue: newAilment,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: staffPlayer?.id ?? null,
    isAutomatic: false,
  });

  const severityEmoji = severity === 'critical' ? '\u2620\uFE0F' : severity === 'major' ? '\u26A0\uFE0F' : '\uD83E\uDE79';

  const embed = createEmbed({
    title: 'Ailment Assigned',
    description: [
      `**${targetPlayer.characterName ?? targetUser.username}** has been afflicted with:`,
      '',
      `${severityEmoji} **${condition}** (${severity})`,
    ].join('\n'),
    system: 'simulation',
    fields: [
      { name: 'Player', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Health Status', value: worstSeverity, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

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

export default command;
