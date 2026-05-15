import {
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections } from '@hansard/db';
import { REACTION_FPTP_MAX_CANDIDATES } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import { seedAllReactionsForOpenVote } from './_seedFptpReactions.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote open election:<title-or-id> — staff/Chancellor opens an election for voting.
 *
 * Mirrors VoteService.openVoting: transitions status to `voting_open`.
 * Looks up election by title or ID and updates its status.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member as GuildMember | null;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    const permitted = await hasPermission(member, 'voting.create');
    if (!permitted) {
      await interaction.editReply({
        embeds: [errorEmbed('Only the Chancellor or staff can open elections.')],
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

    if (election.status === 'voting_open') {
      await interaction.editReply({
        embeds: [errorEmbed('This election is already open for voting.')],
      });
      return;
    }

    if (election.status === 'certified' || election.status === 'cancelled') {
      await interaction.editReply({
        embeds: [errorEmbed(`Cannot open an election in \`${election.status}\` status.`)],
      });
      return;
    }

    // Mirror VoteService.openVoting
    const [updated] = await db
      .update(elections)
      .set({ status: 'voting_open', updatedAt: new Date() })
      .where(eq(elections.id, election.id))
      .returning();

    if (!updated) {
      await interaction.editReply({
        embeds: [errorEmbed('Failed to open election.')],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Voting Opened',
          `**${updated.title}** is now open for voting. Players may cast ballots until <t:${Math.floor(updated.votingClosesAt.getTime() / 1000)}:F>.`,
        ),
      ],
    });

    // Trigger B — safety-net seeder for reaction-mode FPTP votes. Walk every
    // non-withdrawn candidate in registration order and add 1️⃣..N reactions
    // to the public vote message. Idempotent (Discord ignores duplicate
    // reaction-adds on the bot's own emoji), so this re-runs cleanly even
    // if Trigger A in /vote candidate-submit already seeded most slots.
    //
    // Order matters: events/messageReactionAdd.ts maps emoji → candidate by
    // registeredAt asc, so the helper's same ordering is load-bearing.
    if (updated.useReactions && updated.method === 'fptp' && updated.discordMessageId) {
      try {
        const result = await seedAllReactionsForOpenVote({
          client: interaction.client,
          electionId: updated.id,
          channelId: updated.discordChannelId,
          messageId: updated.discordMessageId,
        });

        if (result.overflow) {
          // More candidates than reaction slots — warn staff ephemerally.
          // Don't error; the vote still opens and the first 9 are reactable.
          await interaction.followUp({
            embeds: [errorEmbed(
              `Warning: this election has **${result.totalCandidates}** candidates but reaction mode supports only ${REACTION_FPTP_MAX_CANDIDATES}. ` +
              `Reactions 1️⃣..${REACTION_FPTP_MAX_CANDIDATES}️⃣ have been seeded for the first ${REACTION_FPTP_MAX_CANDIDATES} candidates by registration order; later candidates cannot be voted for via reactions. ` +
              `Consider closing the vote and re-creating in button mode, or withdrawing extra candidates.`,
            )],
            ephemeral: true,
          });
        } else if (result.seededCount === 0 && result.totalCandidates > 0) {
          // We had candidates but couldn't fetch the message (deleted? perms?).
          await interaction.followUp({
            embeds: [errorEmbed(
              `Heads up: could not seed reaction emoji on the vote message — it may have been deleted or the bot lost access. ` +
              `Voters will not see candidate reactions to click. Re-post the vote or switch to button mode.`,
            )],
            ephemeral: true,
          });
        }
      } catch (error) {
        // Don't block the announcement on a seeding failure.
        console.error('[vote-open] reaction seeding failed:', error);
      }
    }

    // Public announcement
    const announce = createEmbed({
      title: 'Voting is Open',
      description: `**${updated.title}** is now open for voting.\n\nClosing: <t:${Math.floor(updated.votingClosesAt.getTime() / 1000)}:F>\nMethod: \`${updated.method}\``,
      system: 'voting',
    });

    if (interaction.channel && 'send' in interaction.channel) {
      try {
        await (interaction.channel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [announce] });
      } catch {
        // Non-critical announcement
      }
    }
}
