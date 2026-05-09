import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote-certify election:<title-or-id> — staff certifies the result post-tally.
 *
 * Mirrors VoteService.certifyElection: validates NPC confirmation (if
 * required) and transitions status to `certified`.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-certify')
    .setDescription('Certify a tallied election result (staff)')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title or ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member as GuildMember | null;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    const permitted = await hasPermission(member, 'voting.close');
    if (!permitted) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can certify elections.')],
      });
      return;
    }

    const electionRef = interaction.options.getString('election', true);

    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    if (election.status === 'certified') {
      await interaction.editReply({
        embeds: [errorEmbed('This election has already been certified.')],
      });
      return;
    }

    // Mirror VoteService.certifyElection guards
    const config = election.config ?? {};
    if (config.requiresNpcConfirmation) {
      const npc = election.npcConfirmation;
      if (!npc || npc.status === 'pending') {
        await interaction.editReply({
          embeds: [errorEmbed('NPC confirmation is still pending. Use `/vote-npc-confirm` first.')],
        });
        return;
      }
      if (npc.status === 'rejected') {
        await interaction.editReply({
          embeds: [errorEmbed('NPC house rejected this election result; cannot certify.')],
        });
        return;
      }
    }

    const [updated] = await db
      .update(elections)
      .set({ status: 'certified', updatedAt: new Date() })
      .where(eq(elections.id, election.id))
      .returning();

    if (!updated) {
      await interaction.editReply({
        embeds: [errorEmbed('Failed to certify election.')],
      });
      return;
    }

    // TODO: For position_election with forOfficeId, auto-appoint winner to
    // the office and sync Discord role. The bot package doesn't have an
    // OfficeService and shouldn't reimplement that here — handled by the
    // API service layer (VoteService.certifyElection's TODO).

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Election Certified',
          `**${updated.title}** is now certified. ${
            updated.forOfficeId
              ? 'Office appointment must be processed via the API.'
              : 'Result is final.'
          }`,
        ),
      ],
    });

    // Public announcement
    const r = updated.results;
    const winnerLine = r?.winners?.length ? `\n**Winner(s):** ${r.winners.join(', ')}` : '';
    const announce = createEmbed({
      title: 'Election Certified',
      description: `**${updated.title}** has been certified.${winnerLine}`,
      system: 'voting',
    });

    if (interaction.channel && 'send' in interaction.channel) {
      try {
        await (interaction.channel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [announce] });
      } catch {
        // Non-critical announcement
      }
    }
  },
};

export default command;
