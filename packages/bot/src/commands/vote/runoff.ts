import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { and, eq, inArray } from 'drizzle-orm';
import { elections, candidates } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote-runoff election:<title-or-id> — Chancellor/staff spawns a runoff round.
 *
 * Mirrors VoteService.createRunoff. Selects qualifying candidates from the
 * existing `results.finalTallies`, creates a child election with
 * `parentElectionId` set, copies candidate rows, and points the original at
 * the new election.
 *
 * Method-specific runoff rules (TwoRoundRunoffStrategy, ExhaustiveBallot):
 * the bot doesn't import the API tally strategies, so this command falls
 * back to a generic "top 2 by finalTallies" rule. For exhaustive_ballot
 * (eliminate-lowest) and two_round_runoff (specific top-N rules), use the
 * API endpoint instead. TODO if/when strategies move to @hansard/shared.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-runoff')
    .setDescription('Spawn a runoff round for an election (Chancellor/staff)')
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

    const permitted = await hasPermission(member, 'voting.create');
    if (!permitted) {
      await interaction.editReply({
        embeds: [errorEmbed('Only the Chancellor or staff can spawn runoffs.')],
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

    if (election.status !== 'runoff_needed') {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Election must be in \`runoff_needed\` status to spawn a runoff (currently \`${election.status}\`).`,
          ),
        ],
      });
      return;
    }

    const results = election.results;
    if (!results) {
      await interaction.editReply({
        embeds: [errorEmbed('Election has no tally results to draw a runoff from.')],
      });
      return;
    }

    // Generic top-2 selection. See file-header note re: method-specific rules.
    const sorted = Object.entries(results.finalTallies).sort((a, b) => b[1] - a[1]);
    const runoffCandidateIds = sorted.slice(0, 2).map(([id]) => id);

    if (runoffCandidateIds.length < 2) {
      await interaction.editReply({
        embeds: [errorEmbed('Not enough candidates with votes to spawn a runoff.')],
      });
      return;
    }

    const runoffRound = (election.roundNumber ?? 1) + 1;
    const rootId = election.parentElectionId ?? election.id;

    // Mirror VoteService.createRunoff insert
    const [runoff] = await db
      .insert(elections)
      .values({
        title: `${election.title} (Round ${runoffRound})`,
        description: election.description,
        type: election.type,
        method: election.method,
        config: election.config,
        requiredPermission: election.requiredPermission,
        forOfficeId: election.forOfficeId,
        parentElectionId: rootId,
        roundNumber: runoffRound,
        votingOpensAt: new Date(),
        votingClosesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: election.createdById,
        discordChannelId: election.discordChannelId,
        status: 'draft',
      })
      .returning();

    if (!runoff) {
      await interaction.editReply({
        embeds: [errorEmbed('Failed to create runoff election.')],
      });
      return;
    }

    // Copy qualifying candidates to the runoff
    const originalCandidates = await db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.electionId, election.id),
          inArray(candidates.playerId, runoffCandidateIds),
        ),
      );

    if (originalCandidates.length > 0) {
      await db.insert(candidates).values(
        originalCandidates.map((c) => ({
          electionId: runoff.id,
          playerId: c.playerId,
          partyId: c.partyId,
          statement: c.statement,
          nominatedById: c.nominatedById,
        })),
      );
    }

    // Link the runoff back onto the original
    await db
      .update(elections)
      .set({
        results: { ...results, runoffElectionId: runoff.id },
        updatedAt: new Date(),
      })
      .where(eq(elections.id, election.id));

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Runoff Created',
          `**${runoff.title}** (round ${runoffRound}) created with ${originalCandidates.length} candidate(s). Use \`/vote-open\` to open it for voting.`,
        ),
      ],
    });

    // Public announcement
    const announce = createEmbed({
      title: 'Runoff Election',
      description: `**${runoff.title}** has been spawned. ${originalCandidates.length} candidate(s) advance.`,
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
