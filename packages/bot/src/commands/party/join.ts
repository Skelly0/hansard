import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, playerEventLog } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { clearPartyLeaderIfMatches } from './shared.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const partyInput = interaction.options.getString('party', true).trim();

  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (playerRows.length === 0 || !playerRows[0].characterName) {
    await interaction.editReply({
      embeds: [
        errorEmbed('You haven\'t created a character yet. Use `/character create` first.'),
      ],
    });
    return;
  }

  const player = playerRows[0];

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

  if (player.partyId === targetParty.id) {
    await interaction.editReply({
      embeds: [
        errorEmbed(`You're already a member of **${targetParty.name}**.`),
      ],
    });
    return;
  }

  if (targetParty.isInviteOnly) {
    await interaction.editReply({
      embeds: [
        errorEmbed(`**${targetParty.name}** is invite-only. Ask staff to add you to the party.`),
      ],
    });
    return;
  }

  let oldPartyName = 'Independent';
  if (player.partyId) {
    const oldPartyRows = await db
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, player.partyId))
      .limit(1);
    if (oldPartyRows.length > 0) oldPartyName = oldPartyRows[0].name;
  }

  await db
    .update(players)
    .set({
      partyId: targetParty.id,
      lastActiveAt: new Date(),
    })
    .where(eq(players.id, player.id));

  await clearPartyLeaderIfMatches(player.partyId, player.id);

  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: 'party_change',
    description: `${player.characterName} left ${oldPartyName} and joined ${targetParty.name}.`,
    oldValue: { partyId: player.partyId, partyName: oldPartyName },
    newValue: { partyId: targetParty.id, partyName: targetParty.name },
    triggeredById: player.id,
  });

  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (member) {
    if (player.partyId) {
      const oldParty = await db
        .select({ discordRoleId: parties.discordRoleId })
        .from(parties)
        .where(eq(parties.id, player.partyId))
        .limit(1);

      if (oldParty[0]?.discordRoleId) {
        try {
          await member.roles.remove(oldParty[0].discordRoleId);
        } catch (err) {
          console.warn(`Failed to remove old party role: ${err}`);
        }
      }
    }

    if (targetParty.discordRoleId) {
      try {
        await member.roles.add(targetParty.discordRoleId);
      } catch (err) {
        console.warn(`Failed to add new party role: ${err}`);
      }
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Joined',
        `**${player.characterName}** has joined **${targetParty.name}**.`,
      ),
    ],
  });
}
