import {
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { modActions, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
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
      embeds: [errorEmbed('You do not have permission to view moderation actions.')],
    });
    return;
  }

  const typeFilter = interaction.options.getString('type');
  const activeFilter = interaction.options.getBoolean('active');

  const conditions: SQL[] = [];
  if (typeFilter) conditions.push(eq(modActions.type, typeFilter));
  if (activeFilter !== null) conditions.push(eq(modActions.isActive, activeFilter));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: modActions.id,
      type: modActions.type,
      reason: modActions.reason,
      isActive: modActions.isActive,
      createdAt: modActions.createdAt,
      appealStatus: modActions.appealStatus,
      targetCharacter: players.characterName,
    })
    .from(modActions)
    .leftJoin(players, eq(modActions.targetPlayerId, players.id))
    .where(whereClause)
    .orderBy(desc(modActions.createdAt))
    .limit(15);

  if (rows.length === 0) {
    const embed = createEmbed({
      title: 'Moderation Actions',
      description: '_No actions match those filters._',
      system: 'moderation',
    });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const filterLabel: string[] = [];
  if (typeFilter) filterLabel.push(`type=\`${formatType(typeFilter)}\``);
  if (activeFilter !== null) filterLabel.push(`active=\`${activeFilter}\``);

  const lines = rows.map((r) => {
    const status = r.isActive ? '**ACTIVE**' : '~~expired~~';
    const date = `<t:${Math.floor(r.createdAt.getTime() / 1000)}:R>`;
    const appeal = r.appealStatus ? ` _[appeal: ${r.appealStatus}]_` : '';
    const target = r.targetCharacter ?? 'Unknown';
    const idShort = r.id.slice(0, 8);
    return [
      `\`${idShort}\` ${status} \`${formatType(r.type)}\`${appeal}`,
      `→ **${target}** ${date}`,
      `> ${truncate(r.reason, 120)}`,
    ].join('\n');
  });

  const embed = createEmbed({
    title: 'Moderation Actions',
    description: [
      filterLabel.length > 0 ? `**Filters:** ${filterLabel.join(' | ')}` : '_No filters applied._',
      `**Showing:** ${rows.length} most recent`,
      '',
      lines.join('\n\n'),
    ].join('\n'),
    system: 'moderation',
  });

  await interaction.editReply({ embeds: [embed] });
}
