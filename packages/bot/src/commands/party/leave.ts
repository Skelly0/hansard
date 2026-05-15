import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, playerEventLog } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { clearPartyLeaderIfMatches } from './shared.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

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

  if (!player.partyId) {
    await interaction.editReply({
      embeds: [errorEmbed('You\'re already independent (no party).')],
    });
    return;
  }

  let oldPartyName = 'Unknown';
  const oldPartyRows = await db
    .select({ name: parties.name, discordRoleId: parties.discordRoleId })
    .from(parties)
    .where(eq(parties.id, player.partyId))
    .limit(1);

  if (oldPartyRows.length > 0) oldPartyName = oldPartyRows[0].name;

  await db
    .update(players)
    .set({
      partyId: null,
      lastActiveAt: new Date(),
    })
    .where(eq(players.id, player.id));

  await clearPartyLeaderIfMatches(player.partyId, player.id);

  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: 'party_change',
    description: `${player.characterName} left ${oldPartyName} and became independent.`,
    oldValue: { partyId: player.partyId, partyName: oldPartyName },
    newValue: { partyId: null, partyName: 'Independent' },
    triggeredById: player.id,
  });

  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (member && oldPartyRows[0]?.discordRoleId) {
    try {
      await member.roles.remove(oldPartyRows[0].discordRoleId);
    } catch (err) {
      console.warn(`Failed to remove party role: ${err}`);
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Left',
        `**${player.characterName}** has left **${oldPartyName}** and is now independent.`,
      ),
    ],
  });
}
