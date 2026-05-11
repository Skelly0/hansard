import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { ballots, players } from '@hansard/db';
import { hasVotingCloseTimePassed } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote-eligibility election:<title-or-id> — invoking player checks if they can vote.
 *
 * Mirrors VoteService.getEligibility. Looks up the player by Discord ID,
 * checks election status/window, ensures they haven't voted yet, and
 * (best-effort) checks faction/party constraints from config.
 *
 * Public response (so the player can show staff if disputed) but ephemeral
 * to avoid spamming the channel.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-eligibility')
    .setDescription('Check if you can vote in an election')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title or ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const electionRef = interaction.options.getString('election', true);
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));

    // Look up player by Discord ID
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!player) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            'You are not registered as a player. Use `/character create` first.',
          ),
        ],
      });
      return;
    }

    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election || (election.status === 'draft' && !actorIsStaff)) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    // Mirror VoteService.getEligibility
    const reasons: string[] = [];
    let eligible = true;

    if (election.status !== 'voting_open') {
      eligible = false;
      reasons.push(`Voting is not open (status: \`${election.status}\`).`);
    }
    if (eligible && hasVotingCloseTimePassed(election.votingClosesAt)) {
      eligible = false;
      reasons.push('Voting has closed.');
    }

    if (eligible && player.isAlive === false) {
      eligible = false;
      reasons.push('Dead characters cannot vote.');
    }

    if (eligible) {
      const existing = await db
        .select()
        .from(ballots)
        .where(
          and(
            eq(ballots.electionId, election.id),
            eq(ballots.voterId, player.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        eligible = false;
        reasons.push('You have already voted in this election.');
      }
    }

    // Best-effort eligibility filters from config
    const config = election.config ?? {};
    if (eligible && config.eligibleFactions?.length) {
      if (!player.factionId || !config.eligibleFactions.includes(player.factionId)) {
        eligible = false;
        reasons.push('Your faction is not eligible to vote in this election.');
      }
    }
    if (eligible && config.eligibleParties?.length) {
      if (!player.partyId || !config.eligibleParties.includes(player.partyId)) {
        eligible = false;
        reasons.push('Your party is not eligible to vote in this election.');
      }
    }
    // TODO: config.eligibleOffices — needs office_holders join (skipped for now).

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Election', value: election.title, inline: false },
      { name: 'Status', value: `\`${election.status}\``, inline: true },
      {
        name: 'Eligible',
        value: eligible ? 'Yes' : 'No',
        inline: true,
      },
    ];
    if (!eligible) {
      fields.push({ name: 'Reason(s)', value: reasons.join('\n') });
    }

    const embed = createEmbed({
      title: 'Voting Eligibility',
      description: eligible
        ? `**${player.characterName ?? player.discordUsername}**, you may cast a ballot. Use \`/vote-cast\`.`
        : `**${player.characterName ?? player.discordUsername}**, you cannot vote in this election.`,
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
