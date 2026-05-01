import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { elections, ballots, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /vote-turnout election:<title> — live turnout stats. Public.
 *
 * Mirrors VoteService.getTurnout: counts ballots cast for the election.
 * Adds a turnout percentage if we can derive a denominator from the
 * active player base (best-effort; eligibility filters are not applied).
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-turnout')
    .setDescription('Show live turnout stats for an election')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const electionTitle = interaction.options.getString('election', true);

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

    // Mirror VoteService.getTurnout
    const cast = await db
      .select({ id: ballots.id })
      .from(ballots)
      .where(eq(ballots.electionId, election.id));

    // Best-effort denominator: count of active, alive players. Doesn't apply
    // election.config.eligibleFactions/Parties/Offices filters — TODO if a
    // shared eligibility helper is later added to @hansard/shared.
    const activePool = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.isActive, true));

    const totalBallots = cast.length;
    const denom = activePool.length;
    const pct = denom > 0 ? ((totalBallots / denom) * 100).toFixed(1) : null;

    const config = election.config ?? {};
    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Status', value: `\`${election.status}\``, inline: true },
      { name: 'Method', value: `\`${election.method}\``, inline: true },
      { name: 'Ballots Cast', value: String(totalBallots), inline: true },
      {
        name: 'Active Players',
        value: String(denom),
        inline: true,
      },
    ];
    if (pct !== null) {
      fields.push({ name: 'Turnout', value: `${pct}%`, inline: true });
    }

    if (config.quorumRequired != null) {
      const quorumDisplay =
        config.quorumType === 'percentage'
          ? `${(config.quorumRequired * 100).toFixed(0)}%`
          : String(config.quorumRequired);
      let met = false;
      if (config.quorumType === 'percentage' && denom > 0) {
        met = totalBallots / denom >= config.quorumRequired;
      } else if (config.quorumType !== 'percentage') {
        met = totalBallots >= config.quorumRequired;
      }
      fields.push({
        name: 'Quorum',
        value: `${quorumDisplay} — ${met ? 'met' : 'not yet met'}`,
        inline: true,
      });
    }

    if (election.votingClosesAt) {
      fields.push({
        name: 'Closes',
        value: `<t:${Math.floor(election.votingClosesAt.getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    const embed = createEmbed({
      title: `Turnout: ${election.title}`,
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
