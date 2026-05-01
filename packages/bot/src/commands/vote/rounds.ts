import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike, inArray } from 'drizzle-orm';
import { elections, candidates, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /vote-rounds election:<title> — show round-by-round results for
 * ranked-choice / runoff / STV / exhaustive ballot elections.
 *
 * Mirrors VoteService.getRounds: walks the parent/child election chain
 * and renders each round's tallies and eliminations.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-rounds')
    .setDescription('Show round-by-round results for an election')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const electionTitle = interaction.options.getString('election', true);

    // 1. Look up the (potentially child) election
    const [seed] = await db
      .select()
      .from(elections)
      .where(ilike(elections.title, electionTitle))
      .limit(1);

    if (!seed) {
      await interaction.editReply({
        embeds: [errorEmbed(`No election found with title \`${electionTitle}\`.`)],
      });
      return;
    }

    // 2. Walk the chain — mirror VoteService.getRounds
    const rootId = seed.parentElectionId ?? seed.id;

    const [root] = await db
      .select()
      .from(elections)
      .where(eq(elections.id, rootId))
      .limit(1);

    const children = await db
      .select()
      .from(elections)
      .where(eq(elections.parentElectionId, rootId))
      .orderBy(elections.roundNumber);

    const chain = root ? [root, ...children] : children;

    if (chain.length === 0) {
      await interaction.editReply({
        embeds: [errorEmbed('Could not load election chain.')],
      });
      return;
    }

    // 3. Build candidate-name lookup across all rounds
    const allElectionIds = chain.map((e) => e.id);
    const allCandidates = await db
      .select()
      .from(candidates)
      .where(inArray(candidates.electionId, allElectionIds));

    const playerIds = Array.from(new Set(allCandidates.map((c) => c.playerId)));
    const playerRows = playerIds.length > 0
      ? await db
          .select({
            id: players.id,
            characterName: players.characterName,
            discordUsername: players.discordUsername,
          })
          .from(players)
          .where(inArray(players.id, playerIds))
      : [];

    const nameMap = new Map(
      playerRows.map((p) => [p.id, p.characterName ?? p.discordUsername]),
    );

    // 4. Render each round
    const fields: { name: string; value: string; inline?: boolean }[] = [];

    for (const e of chain) {
      const r = e.results;
      const header = `Round ${e.roundNumber} — \`${e.status}\``;

      if (!r) {
        fields.push({ name: header, value: '*Not yet tallied.*' });
        continue;
      }

      // Inline rounds (ranked-choice, exhaustive single-ballot) live inside results.rounds
      if (r.rounds && r.rounds.length > 0) {
        const lines = r.rounds.map((round) => {
          const tally = Object.entries(round.tallies)
            .sort((a, b) => b[1] - a[1])
            .map(([id, v]) => `${nameMap.get(id) ?? id}: \`${v}\``)
            .join(', ');
          const elim = round.eliminated
            ? ` — *${nameMap.get(round.eliminated) ?? round.eliminated} eliminated*`
            : '';
          return `**R${round.round}** ${tally}${elim}`;
        });
        fields.push({ name: header, value: lines.join('\n').slice(0, 1024) });
      } else {
        // Single-tally round (e.g. two_round_runoff per-round)
        const tally = Object.entries(r.finalTallies)
          .sort((a, b) => b[1] - a[1])
          .map(([id, v]) => `${nameMap.get(id) ?? id}: \`${v}\``)
          .join('\n');
        const winners = r.winners?.length
          ? `\n**Winner(s):** ${r.winners.map((id) => nameMap.get(id) ?? id).join(', ')}`
          : '';
        const runoff = r.runoffTriggered ? '\n*Runoff triggered.*' : '';
        fields.push({
          name: header,
          value: `${tally || '*No votes.*'}${winners}${runoff}`.slice(0, 1024),
        });
      }
    }

    const embed = createEmbed({
      title: `Rounds: ${root?.title ?? seed.title}`,
      description: `Method: \`${seed.method}\` • ${chain.length} round(s) in chain`,
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
