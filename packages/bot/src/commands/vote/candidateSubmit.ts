import type { ChatInputCommandInteraction } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { candidates, players, parties } from '@hansard/db';
import { REACTION_FPTP_MAX_CANDIDATES } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { seedReactionForNewCandidate } from './_seedFptpReactions.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote candidate-submit election:<title-or-id> — register the invoking player
 * as a candidate in a position election.
 *
 * Mirrors VoteService.registerCandidate. Looks up the election by title or ID.
 * Fails clearly if the invoker isn't a registered player or nominations aren't open.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const electionRef = interaction.options.getString('election', true);
    const statement = interaction.options.getString('statement') ?? undefined;
    const discordId = interaction.user.id;

    // 1. Look up the invoking player
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, discordId))
      .limit(1);

    if (!player) {
      await interaction.editReply({
        embeds: [errorEmbed('You are not registered as a player. Use `/character create` first.')],
      });
      return;
    }
    if (!player.characterName) {
      await interaction.editReply({
        embeds: [errorEmbed('You need to create a character before standing as a candidate.')],
      });
      return;
    }
    if (!player.isAlive) {
      await interaction.editReply({
        embeds: [errorEmbed('Dead characters cannot stand as candidates.')],
      });
      return;
    }

    // 2. Look up the election by title or ID.
    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    // 3. Check the election is accepting nominations
    if (!['draft', 'nominations_open'].includes(election.status)) {
      await interaction.editReply({
        embeds: [errorEmbed(
          `Nominations are not open for **${election.title}** (status: \`${election.status}\`).`,
        )],
      });
      return;
    }

    // 4. Check not already registered
    const existing = await db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.electionId, election.id),
          eq(candidates.playerId, player.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await interaction.editReply({
        embeds: [errorEmbed('You are already registered as a candidate in this election.')],
      });
      return;
    }

    // 5. Insert candidate
    const [candidate] = await db
      .insert(candidates)
      .values({
        electionId: election.id,
        playerId: player.id,
        partyId: player.partyId ?? null,
        statement: statement ?? null,
      })
      .returning();

    // 6. Resolve party name for display (best-effort)
    let partyName: string | null = null;
    if (candidate.partyId) {
      const [party] = await db
        .select({ name: parties.name })
        .from(parties)
        .where(eq(parties.id, candidate.partyId))
        .limit(1);
      partyName = party?.name ?? null;
    }

    const displayName = player.characterName ?? player.discordUsername;

    const embed = successEmbed(
      'Candidacy Registered',
      `**${displayName}** has entered the race for **${election.title}**.`,
    );
    embed.addFields(
      { name: 'Candidate', value: displayName, inline: true },
      { name: 'Party', value: partyName ?? 'Independent', inline: true },
      { name: 'Election Status', value: election.status, inline: true },
    );
    if (statement) {
      embed.addFields({ name: 'Statement', value: statement });
    }

    await interaction.editReply({ embeds: [embed] });

    // Trigger A — responsive UX: if this is an already-open reaction-mode
    // FPTP vote whose public message exists, seed the next 1️⃣..9️⃣ reaction.
    // During nominations we deliberately avoid seeding vote emoji so players
    // don't cast visible reactions before the vote is open.
    //
    // Best-effort: any failure here is logged inside the helper and never
    // surfaces back to the candidate (the registration itself succeeded).
    // Trigger B in /vote open is the safety net that re-seeds at open time.
    if (
      election.status === 'voting_open'
      && election.useReactions
      && election.method === 'fptp'
      && election.discordMessageId
    ) {
      try {
        const result = await seedReactionForNewCandidate({
          client: interaction.client,
          electionId: election.id,
          channelId: election.discordChannelId,
          messageId: election.discordMessageId,
        });

        if (result.overflow) {
          // 10th+ candidate — no emoji to add, warn the registrant ephemerally.
          await interaction.followUp({
            embeds: [errorEmbed(
              `Heads up: this reaction-mode FPTP vote already has ${REACTION_FPTP_MAX_CANDIDATES} candidates with emoji slots. ` +
              `Your candidacy is recorded, but voters will not be able to react for you — staff should switch to button mode or close additional nominations.`,
            )],
            ephemeral: true,
          });
        }
      } catch (error) {
        // Helper already swallows fetch/react failures; this catch is for the
        // outer DB recount only. Don't break the slash command on it.
        console.error('[candidate-submit] reaction seeding failed:', error);
      }
    }
}
