import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, playerEventLog } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { postStaffActionLog } from '../../utils/modLog.js';
import { clearPartyLeaderIfMatches } from './shared.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can assign characters to parties.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const partyInput = interaction.options.getString('party', true).trim();

  const [targetPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (!targetPlayer || !targetPlayer.characterName) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} has no registered character.`)] });
    return;
  }

  const [staffPlayer] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const partyRows = await db
    .select()
    .from(parties)
    .where(eq(parties.isActive, true));

  const targetParty = partyRows.find(
    (p) => p.id === partyInput ||
           p.name.toLowerCase() === partyInput.toLowerCase() ||
           p.shortName?.toLowerCase() === partyInput.toLowerCase(),
  );

  if (!targetParty) {
    const available = partyRows.map((p) => `- ${p.name}${p.shortName ? ` (${p.shortName})` : ''}`).join('\n');
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `No active party found matching **${partyInput}**.\n\n**Available parties:**\n${available || '*No parties available.*'}`,
        ),
      ],
    });
    return;
  }

  if (targetPlayer.partyId === targetParty.id) {
    await interaction.editReply({
      embeds: [errorEmbed(`**${targetPlayer.characterName}** is already a member of **${targetParty.name}**.`)],
    });
    return;
  }

  let oldPartyName = 'Independent';
  let oldPartyRoleId: string | null = null;
  if (targetPlayer.partyId) {
    const [oldParty] = await db
      .select({ name: parties.name, discordRoleId: parties.discordRoleId })
      .from(parties)
      .where(eq(parties.id, targetPlayer.partyId))
      .limit(1);
    oldPartyName = oldParty?.name ?? 'Unknown';
    oldPartyRoleId = oldParty?.discordRoleId ?? null;
  }

  await db
    .update(players)
    .set({ partyId: targetParty.id })
    .where(eq(players.id, targetPlayer.id));

  await clearPartyLeaderIfMatches(targetPlayer.partyId, targetPlayer.id);

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'party_change',
    description: `${targetPlayer.characterName} left ${oldPartyName} and joined ${targetParty.name} (staff action).`,
    oldValue: targetPlayer.partyId ? { partyId: targetPlayer.partyId, partyName: oldPartyName } : null,
    newValue: { partyId: targetParty.id, partyName: targetParty.name },
    triggeredById: staffPlayer?.id ?? null,
  });

  let roleSyncWarning: string | null = null;
  if (interaction.guild && (oldPartyRoleId || targetParty.discordRoleId)) {
    try {
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      if (oldPartyRoleId) await targetMember.roles.remove(oldPartyRoleId);
      if (targetParty.discordRoleId) await targetMember.roles.add(targetParty.discordRoleId);
    } catch (error) {
      console.warn(`Failed to sync party roles for ${targetPlayer.characterName}:`, error);
      roleSyncWarning = '\n\nDiscord role sync failed; run `/sync-roles` after checking the bot role hierarchy.';
    }
  }

  await postStaffActionLog(interaction, {
    title: 'Party Assigned',
    system: 'players',
    fields: [
      { name: 'Player', value: `**${targetPlayer.characterName}** (<@${targetUser.id}>)`, inline: true },
      { name: 'From', value: oldPartyName, inline: true },
      { name: 'To', value: targetParty.name, inline: true },
      ...(roleSyncWarning ? [{ name: 'Warning', value: roleSyncWarning.trim() }] : []),
    ],
  });
  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Assigned',
        `**${targetPlayer.characterName}** has been moved from **${oldPartyName}** to **${targetParty.name}**.${roleSyncWarning ?? ''}`,
      ),
    ],
  });
}
