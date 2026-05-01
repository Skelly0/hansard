import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, count } from 'drizzle-orm';
import { db } from '../../db.js';
import { modActions, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mod-stats')
    .setDescription('Summary stats for moderation actions (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

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
        embeds: [errorEmbed('You do not have permission to view moderation stats.')],
      });
      return;
    }

    // Total
    const [totalResult] = await db.select({ value: count() }).from(modActions);
    const totalActions = totalResult?.value ?? 0;

    // Active
    const [activeResult] = await db
      .select({ value: count() })
      .from(modActions)
      .where(eq(modActions.isActive, true));
    const activeActions = activeResult?.value ?? 0;

    // By type
    const allRows = await db.select({ type: modActions.type }).from(modActions);
    const byType: Record<string, number> = {};
    for (const r of allRows) byType[r.type] = (byType[r.type] ?? 0) + 1;

    // Recent 5
    const recent = await db
      .select({
        id: modActions.id,
        type: modActions.type,
        reason: modActions.reason,
        createdAt: modActions.createdAt,
        targetCharacter: players.characterName,
      })
      .from(modActions)
      .leftJoin(players, eq(modActions.targetPlayerId, players.id))
      .orderBy(desc(modActions.createdAt))
      .limit(5);

    const fields = [
      {
        name: 'Totals',
        value: [
          `**Total Actions:** ${totalActions}`,
          `**Active:** ${activeActions}`,
          `**Expired:** ${totalActions - activeActions}`,
        ].join('\n'),
        inline: false,
      },
    ];

    const byTypeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    if (byTypeEntries.length > 0) {
      fields.push({
        name: 'By Type',
        value: byTypeEntries
          .map(([type, n]) => `\`${formatType(type)}\` — **${n}**`)
          .join('\n'),
        inline: false,
      });
    }

    if (recent.length > 0) {
      fields.push({
        name: 'Recent Activity',
        value: recent
          .map((r) => {
            const date = `<t:${Math.floor(r.createdAt.getTime() / 1000)}:R>`;
            const target = r.targetCharacter ?? 'Unknown';
            return `${date} \`${formatType(r.type)}\` → **${target}**`;
          })
          .join('\n'),
        inline: false,
      });
    }

    const embed = createEmbed({
      title: 'Moderation Stats',
      system: 'moderation',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
