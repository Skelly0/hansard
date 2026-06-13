import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import { parties, players, playerEventLog } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { postStaffActionLog } from '../../utils/modLog.js';
import { refreshPartyJoinMessage } from '../../utils/partyJoinMessage.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can dissolve parties.')] });
    return;
  }

  const confirm = interaction.options.getBoolean('confirm', true);
  if (!confirm) {
    await interaction.editReply({ embeds: [errorEmbed('Pass `confirm:true` — dissolution unassigns every member of the party.')] });
    return;
  }

  const query = interaction.options.getString('party', true);
  const all = await db
    .select()
    .from(parties)
    .where(eq(parties.isActive, true))
    .orderBy(asc(parties.name));

  const target =
    all.find((p) => p.name.toLowerCase() === query.toLowerCase()) ??
    all.find((p) => p.shortName?.toLowerCase() === query.toLowerCase()) ??
    all.find((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  if (!target) {
    await interaction.editReply({ embeds: [errorEmbed(`No active party matching "${query}" found.`)] });
    return;
  }

  try {
    const memberRows = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.partyId, target.id), eq(players.isActive, true)));

    if (memberRows.length > 0) {
      await db
        .update(players)
        .set({ partyId: null })
        .where(eq(players.partyId, target.id));

      for (const m of memberRows) {
        await db.insert(playerEventLog).values({
          playerId: m.id,
          eventType: 'party_change',
          description: `Party "${target.name}" was dissolved`,
          oldValue: { partyId: target.id, partyName: target.name },
          newValue: { partyId: null, partyName: null },
          isAutomatic: false,
        });
      }
    }

    await db
      .update(parties)
      .set({ isActive: false, dissolvedAt: sql`now()`, leaderId: null })
      .where(eq(parties.id, target.id));

    let boardRefreshNotice = '';
    try {
      const refreshed = await refreshPartyJoinMessage(interaction.client);
      if (!refreshed) {
        boardRefreshNotice = [
          '',
          'Party join board cleanup failed: no current join board was found.',
          'Run `pnpm --filter @hansard/bot post:party-join` to post a new one.',
        ].join('\n');
      }
    } catch (error) {
      console.warn(`[party dissolve] failed to refresh party join board after dissolving ${target.id}:`, error);
      boardRefreshNotice = [
        '',
        'Party join board cleanup failed; run `pnpm --filter @hansard/bot refresh:party-join` to refresh it manually.',
      ].join('\n');
    }

    await postStaffActionLog(interaction, {
      title: 'Party Dissolved',
      system: 'players',
      fields: [
        { name: 'Party', value: target.name, inline: true },
        { name: 'Members Unassigned', value: `${memberRows.length}`, inline: true },
      ],
    });
    await interaction.editReply({
      embeds: [successEmbed(
        'Party Dissolved',
        `**${target.name}** has been dissolved. ${memberRows.length} member${memberRows.length === 1 ? '' : 's'} unassigned.\nUse \`/party edit party:${target.name} active:true\` to revive.${boardRefreshNotice}`,
      )],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to dissolve party';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
