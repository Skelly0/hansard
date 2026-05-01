import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { and, eq, ilike } from 'drizzle-orm';
import { elections, candidates, players, parties } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /candidate-submit election:<title> — register the invoking player as a
 * candidate in a position election.
 *
 * Mirrors VoteService.registerCandidate. Looks up the election by title
 * (case-insensitive) since UUIDs are unfriendly in Discord. Fails clearly
 * if the invoker isn't a registered player or nominations aren't open.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('candidate-submit')
    .setDescription('Register yourself as a candidate in an election')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title (e.g. "Governor of Northshire")')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('statement')
        .setDescription('Optional candidate statement / manifesto')
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const electionTitle = interaction.options.getString('election', true);
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

    // 2. Look up the election by title (case-insensitive)
    const [election] = await db
      .select()
      .from(elections)
      .where(ilike(elections.title, electionTitle))
      .limit(1);

    if (!election) {
      await interaction.editReply({
        embeds: [errorEmbed(`No election found with title \`${electionTitle}\`.`)],
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
  },
};

export default command;
