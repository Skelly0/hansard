import type { ChatInputCommandInteraction } from 'discord.js';
import { VoteService } from '@hansard/api/services/voteService';
import { players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { db } from '../../db.js';

/**
 * /vote npc-confirm <election_id> <yea> <nay> <abstain> [notes]
 *
 * Staff-only command to enter the NPC house confirmation result
 * for a position election or appointment confirmation.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Staff check
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    const staffCheck = await isStaff(member as any);
    if (!staffCheck) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff can enter NPC house results.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const electionId = interaction.options.getString('election_id', true);
    const yea = interaction.options.getInteger('yea', true);
    const nay = interaction.options.getInteger('nay', true);
    const abstain = interaction.options.getInteger('abstain', true);
    const notes = interaction.options.getString('notes') ?? undefined;

    const total = yea + nay + abstain;
    const confirmed = yea > nay;

    const actor = await upsertPlayer(interaction.user.id, interaction.user.username);
    if (!actor) {
      await interaction.editReply({
        embeds: [errorEmbed('Could not resolve your player record. Please try again.')],
      });
      return;
    }

    let updated;
    try {
      updated = await new VoteService(db).enterNpcConfirmation(electionId, {
        yea,
        nay,
        abstain,
        enteredById: actor.id,
        notes,
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [errorEmbed(err instanceof Error ? err.message : 'Could not enter NPC confirmation.')],
      });
      return;
    }

    if (!updated) {
      await interaction.editReply({
        embeds: [errorEmbed(`Election \`${electionId}\` not found.`)],
      });
      return;
    }

    const resultColour = confirmed ? 0x788C5D : 0xC25B4E;
    const resultText = confirmed ? 'CONFIRMED' : 'REJECTED';

    const embed = createEmbed({
      title: `NPC House: ${resultText}`,
      description: notes ? `> ${notes}` : undefined,
      system: 'voting',
      colour: resultColour,
      fields: [
        { name: 'Election', value: updated.title, inline: true },
        {
          name: 'NPC Tally',
          value: `\`Yea: ${yea} | Nay: ${nay} | Abs: ${abstain}\``,
          inline: true,
        },
        { name: 'Total', value: `\`${total}\``, inline: true },
        { name: 'Result', value: `**${resultText}**`, inline: true },
      ],
    });

  await interaction.editReply({ embeds: [embed] });
}

async function upsertPlayer(discordId: string, discordUsername: string) {
  try {
    const [player] = await db
      .insert(players)
      .values({ discordId, discordUsername })
      .onConflictDoUpdate({
        target: players.discordId,
        set: { discordUsername },
      })
      .returning();
    return player ?? null;
  } catch (err) {
    console.error('Failed to upsert player for NPC confirmation:', err);
    return null;
  }
}
