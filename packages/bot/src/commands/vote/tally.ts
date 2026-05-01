import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { elections, ballots } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /vote-tally election:<title> — staff force-tally an election.
 *
 * Mirrors VoteService.tallyVotes. The actual tally algorithms live in the
 * API package (`packages/api/src/services/tallying/*`) and are not imported
 * by the bot — bot package depends on `@hansard/db` + `@hansard/shared` only.
 *
 * This command marks the election so an out-of-band tally can be invoked
 * (e.g. via the API endpoint), shows current ballot count, and reports
 * existing results if any. The strategy execution itself is TODO.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-tally')
    .setDescription('Force-tally an election (staff)')
    .addStringOption((opt) =>
      opt
        .setName('election')
        .setDescription('Election title')
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
        embeds: [errorEmbed('Only staff can force-tally an election.')],
      });
      return;
    }

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

    // Mirror VoteService.tallyVotes guard
    if (!['voting_closed', 'voting_open'].includes(election.status)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `Election must be in \`voting_closed\` or \`voting_open\` status to tally (currently \`${election.status}\`).`,
          ),
        ],
      });
      return;
    }

    const allBallots = await db
      .select()
      .from(ballots)
      .where(eq(ballots.electionId, election.id));

    // TODO: Run the tally strategy. The bot package does NOT import
    // `@hansard/api` or its `tallying/*` strategies, so the actual
    // method-specific tally (FPTP / ranked / STV / approval / two-round /
    // exhaustive / yea-nay / proportional) cannot run here.
    //
    // Options to wire this up later:
    //   1. Move strategies into `@hansard/shared` and import them here, OR
    //   2. POST to the API tally endpoint from the bot, OR
    //   3. Have a worker pick up `tally_pending` and run it.
    //
    // For now: surface ballot count + current results, leave status alone.

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Method', value: `\`${election.method}\``, inline: true },
      { name: 'Status', value: `\`${election.status}\``, inline: true },
      { name: 'Ballots Cast', value: String(allBallots.length), inline: true },
    ];

    const r = election.results;
    if (r) {
      const tally = Object.entries(r.finalTallies)
        .sort((a, b) => b[1] - a[1])
        .map(([id, v]) => `\`${id}\`: ${v}`)
        .join('\n');
      if (tally) fields.push({ name: 'Existing Tallies', value: tally.slice(0, 1024) });
      if (r.winners?.length) {
        fields.push({ name: 'Winner(s)', value: r.winners.join(', ') });
      }
    }

    const embed = createEmbed({
      title: `Tally: ${election.title}`,
      description: [
        'The bot cannot run the method-specific tally directly (strategies live in the API package).',
        '',
        'Use the API endpoint `POST /elections/:id/tally` to compute results, then re-run `/vote-info` or `/vote-results` to view them.',
      ].join('\n'),
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
