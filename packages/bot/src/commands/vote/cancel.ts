import {
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import { findElectionByReference } from './_electionReference.js';
import { cancelVote } from './cancelFlow.js';

function formatBillNumber(billNumber: number): string {
  return `B-${String(billNumber).padStart(3, '0')}`;
}

function buildCancelDescription(result: Awaited<ReturnType<typeof cancelVote>>): string {
  const lines = [
    `**${result.election.title}** has been cancelled.`,
    `Previous vote status: \`${result.previousElectionStatus}\`.`,
  ];

  if (result.bill) {
    lines.push(
      `Bill #\`${formatBillNumber(result.bill.billNumber)}\` has been returned to \`submitted\`.`,
    );
  }

  return lines.join('\n');
}

/**
 * /vote cancel election:<title-or-id> — cancels a vote.
 *
 * For linked legislative votes, the linked bill is moved back to submitted
 * and its player-vote fields are cleared in the same transaction.
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

    const permitted = await hasPermission(member, 'voting.cancel');
    if (!permitted) {
      await interaction.editReply({
        embeds: [errorEmbed('Only the Chancellor or staff can cancel elections.')],
      });
      return;
    }

    const electionRef = interaction.options.getString('election', true);
    const reason = interaction.options.getString('reason');
    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    let result: Awaited<ReturnType<typeof cancelVote>>;
    try {
      result = await cancelVote(db, election, {
        actorDiscordId: interaction.user.id,
        reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel vote';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }

    const description = buildCancelDescription(result);
    await interaction.editReply({
      embeds: [successEmbed('Vote Cancelled', description)],
    });

    const announce = createEmbed({
      title: 'Vote Cancelled',
      description,
      system: 'voting',
      colour: 0xC25B4E,
    });

    if (interaction.channel && 'send' in interaction.channel) {
      try {
        await (interaction.channel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [announce] });
      } catch {
        // Non-critical announcement.
      }
    }
}
