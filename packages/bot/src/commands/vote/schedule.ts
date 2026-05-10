import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { elections, players } from '@hansard/db';
import { DEFAULT_VOTE_DURATION_HOURS, SUPERMAJORITY_PASS_THRESHOLD } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { hasPermission, isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /vote-schedule — schedule a *future* vote/election (status `draft`).
 *
 * Originally this was a stub for "show upcoming votes." That read intent is
 * now fully covered by `/vote-list scope:active` (which already shows draft,
 * nominations_open, voting_open, etc., sorted by close time). Rather than
 * duplicate that surface, this command is repurposed as the write counterpart
 * to `/vote create`: it inserts the election with `votingOpensAt` set to a
 * future timestamp and `status = 'draft'`. Staff/Chancellor then runs
 * `/vote-open` at the scheduled moment to flip it to `voting_open`.
 *
 * Permissions:
 * - `voting.create` (Chancellor or staff). Open scheduling to all players
 *   would let anyone clutter the schedule with future drafts; gating to
 *   Chancellor/staff matches `/vote-open` and `/elect`.
 * - The CHANCELLOR_ONLY_TYPES list is re-checked anyway since `voting.create`
 *   currently maps to "Chancellor or staff" — but if that helper is broadened
 *   later this guard preserves the create.ts policy.
 *
 * Why no auto-flip worker:
 * - The codebase has no scheduler/cron loop for elections. Drafts are flipped
 *   manually via `/vote-open`. This command therefore *records* the intended
 *   open time so the schedule is visible in `/vote-list`, but doesn't promise
 *   automatic activation. The embed makes that explicit.
 *
 * Why no modal (unlike /vote create):
 * - A modal would need its own handler registered in events/interactionCreate.ts
 *   (mirroring `vote-create:` -> handleVoteCreateModal). Wiring that is
 *   outside this command's edit scope, and CLAUDE.md notes that unhandled
 *   modal customIds get *only logged* by the global router — they never
 *   reply, which would surface to the user as a generic interaction error.
 *   Inline string options keep everything self-contained.
 */

const CHANCELLOR_ONLY_TYPES = new Set([
  'legislative_vote',
  'position_election',
  'appointment_confirmation',
]);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-schedule')
    .setDescription('Schedule a future vote/election (Chancellor/staff)')
    .addStringOption((opt) =>
      opt
        .setName('title')
        .setDescription('Title of the vote')
        .setRequired(true)
        .setMaxLength(256),
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Type of vote')
        .setRequired(true)
        .addChoices(
          { name: 'Referendum', value: 'referendum' },
          { name: 'Confidence Vote', value: 'confidence_vote' },
          { name: 'Party Primary', value: 'party_primary' },
          { name: 'Custom Vote', value: 'custom' },
          { name: 'Legislative Vote (Chancellor)', value: 'legislative_vote' },
          { name: 'Position Election (Chancellor)', value: 'position_election' },
          { name: 'Appointment Confirmation (Chancellor)', value: 'appointment_confirmation' },
          { name: 'General Election', value: 'general_election' },
          { name: 'Constitutional Amendment', value: 'constitutional_amendment' },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName('method')
        .setDescription('Voting method')
        .setRequired(true)
        .addChoices(
          { name: 'Yea / Nay / Abstain', value: 'yea_nay_abstain' },
          { name: 'First Past the Post', value: 'fptp' },
          { name: 'Ranked Choice (Instant Runoff)', value: 'ranked_choice' },
          { name: 'Approval Voting', value: 'approval' },
          { name: 'Two-Round Runoff', value: 'two_round_runoff' },
          { name: 'Exhaustive Ballot', value: 'exhaustive_ballot' },
          { name: 'Single Transferable Vote', value: 'stv' },
          { name: 'Proportional Representation', value: 'proportional' },
        ),
    )
    .addNumberOption((opt) =>
      opt
        .setName('opens-in-hours')
        .setDescription('Hours from now until voting opens (e.g. 24 = tomorrow)')
        .setRequired(true)
        .setMinValue(0.25)
        .setMaxValue(24 * 365),
    )
    .addNumberOption((opt) =>
      opt
        .setName('duration-hours')
        .setDescription(`How long voting stays open after it opens (default ${DEFAULT_VOTE_DURATION_HOURS})`)
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(24 * 365),
    )
    .addStringOption((opt) =>
      opt
        .setName('description')
        .setDescription('What is being voted on')
        .setRequired(false)
        .setMaxLength(2000),
    )
    .addStringOption((opt) =>
      opt
        .setName('majority')
        .setDescription('Majority type (yea/nay only)')
        .setRequired(false)
        .addChoices(
          { name: 'Simple Majority', value: 'simple' },
          { name: 'Absolute Majority', value: 'absolute' },
          { name: 'Supermajority (2/3)', value: 'supermajority' },
          { name: 'Unanimous', value: 'unanimous' },
        ),
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
        embeds: [errorEmbed('Only the Chancellor or staff can schedule future votes.')],
      });
      return;
    }

    const title = interaction.options.getString('title', true).trim();
    const electionType = interaction.options.getString('type', true);
    const method = interaction.options.getString('method', true);
    const opensInHours = interaction.options.getNumber('opens-in-hours', true);
    const durationHours = interaction.options.getNumber('duration-hours') ?? DEFAULT_VOTE_DURATION_HOURS;
    const description = interaction.options.getString('description')?.trim() || null;
    const majority = interaction.options.getString('majority') ?? 'simple';

    // Belt-and-braces: re-enforce the chancellor-only policy from create.ts.
    // `hasPermission('voting.create')` already gates this today, but if that
    // mapping ever broadens we still want CHANCELLOR_ONLY_TYPES to require
    // chancellor-or-staff rather than just any creator-permitted role.
    if (CHANCELLOR_ONLY_TYPES.has(electionType)) {
      const allowed = await isStaff(member);
      if (!allowed) {
        // hasPermission already approved them, but for safety re-check that
        // restricted types stay locked to staff/chancellor.
        const stillPermitted = await hasPermission(member, 'voting.create');
        if (!stillPermitted) {
          await interaction.editReply({
            embeds: [errorEmbed('Only the Chancellor or staff can schedule this type of vote.')],
          });
          return;
        }
      }
    }

    // Defensive: getNumber's min/max already constrains via Discord, but a
    // malformed payload from a non-Discord client could still slip through.
    if (!Number.isFinite(opensInHours) || opensInHours <= 0) {
      await interaction.editReply({
        embeds: [errorEmbed('`opens-in-hours` must be a positive number.')],
      });
      return;
    }
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      await interaction.editReply({
        embeds: [errorEmbed('`duration-hours` must be a positive number.')],
      });
      return;
    }

    const now = new Date();
    const votingOpensAt = new Date(now.getTime() + opensInHours * 60 * 60 * 1000);
    const votingClosesAt = new Date(votingOpensAt.getTime() + durationHours * 60 * 60 * 1000);

    // Sanity guards — the slash-option min/max should make these unreachable
    // from a legitimate Discord client, but defensive checks are cheap.
    if (votingOpensAt.getTime() <= now.getTime()) {
      await interaction.editReply({
        embeds: [errorEmbed('Scheduled open time is not in the future. Use a larger `opens-in-hours`.')],
      });
      return;
    }
    if (votingClosesAt.getTime() <= votingOpensAt.getTime()) {
      await interaction.editReply({
        embeds: [errorEmbed('Voting window must be at least 1 hour long.')],
      });
      return;
    }

    // Build the config — same shape as /vote create.
    const config: Record<string, unknown> = {};
    if (method === 'yea_nay_abstain') {
      config.majorityType = majority;
      if (majority === 'supermajority') {
        config.passThreshold = SUPERMAJORITY_PASS_THRESHOLD;
      }
    }
    if (['two_round_runoff', 'fptp'].includes(method)) {
      config.runoffEnabled = method === 'two_round_runoff';
      config.runoffThreshold = 0.5;
    }

    const [creator] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!creator) {
      await interaction.editReply({
        embeds: [
          errorEmbed('You are not registered as a player. Run `/character create` first.'),
        ],
      });
      return;
    }

    let electionId: string;
    try {
      // Direct DB write per CLAUDE.md "vote/election writes are direct DB."
      // Single atomic insert; no transaction needed (no follow-on side
      // effects — we don't post a Discord embed or seed reactions until the
      // staff member runs /vote-open).
      const [row] = await db
        .insert(elections)
        .values({
          title,
          description,
          type: electionType,
          method,
          config: config as any,
          votingOpensAt,
          votingClosesAt,
          status: 'draft',
          createdById: creator.id,
          // Reaction-mode is configured at /vote-open time via /vote create's
          // reactions interface; scheduled drafts don't pre-post embeds.
          useReactions: false,
        })
        .returning({ id: elections.id });
      electionId = row.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule election';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }

    const methodLabels: Record<string, string> = {
      yea_nay_abstain: 'Yea / Nay / Abstain',
      fptp: 'First Past the Post',
      ranked_choice: 'Ranked Choice (IRV)',
      approval: 'Approval Voting',
      two_round_runoff: 'Two-Round Runoff',
      exhaustive_ballot: 'Exhaustive Ballot',
      stv: 'Single Transferable Vote',
      proportional: 'Proportional Representation',
    };

    const typeLabels: Record<string, string> = {
      referendum: 'Referendum',
      confidence_vote: 'Vote of Confidence',
      party_primary: 'Party Primary',
      custom: 'Custom Vote',
      legislative_vote: 'Legislative Vote',
      position_election: 'Position Election',
      appointment_confirmation: 'Appointment Confirmation',
      general_election: 'General Election',
      constitutional_amendment: 'Constitutional Amendment',
    };

    const opensTs = Math.floor(votingOpensAt.getTime() / 1000);
    const closesTs = Math.floor(votingClosesAt.getTime() / 1000);

    const fields = [
      { name: 'Type', value: typeLabels[electionType] ?? electionType, inline: true },
      { name: 'Method', value: methodLabels[method] ?? method, inline: true },
      { name: 'Status', value: 'Draft (scheduled)', inline: true },
      { name: 'Opens', value: `<t:${opensTs}:F> (<t:${opensTs}:R>)`, inline: false },
      { name: 'Closes', value: `<t:${closesTs}:F> (<t:${closesTs}:R>)`, inline: false },
      ...(method === 'yea_nay_abstain'
        ? [
            {
              name: 'Majority',
              value: majority.charAt(0).toUpperCase() + majority.slice(1),
              inline: true,
            },
          ]
        : []),
      { name: 'Election ID', value: `\`${electionId}\``, inline: false },
    ];

    const ephemeralEmbed = createEmbed({
      title: `Scheduled: ${title}`,
      description: [
        description ? `> ${description}\n` : '',
        `This vote is **scheduled** but not yet open. There is no auto-flip worker — staff must run \`/vote-open election:${title}\` at the scheduled time to begin accepting ballots.`,
        '',
        'See it alongside other upcoming votes via `/vote-list scope:active`.',
      ]
        .filter(Boolean)
        .join('\n'),
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [ephemeralEmbed] });

    // Public announcement so the calendar is visible to the chamber.
    // Mirrors the announce pattern in /vote-open and /vote-close (best-effort,
    // non-fatal if the channel won't accept it).
    if (interaction.channel && 'send' in interaction.channel) {
      const announceEmbed = createEmbed({
        title: 'Vote Scheduled',
        description: [
          `**${title}** has been scheduled.`,
          description ? `\n> ${description}` : '',
        ]
          .filter(Boolean)
          .join(''),
        system: 'voting',
        fields: [
          { name: 'Type', value: typeLabels[electionType] ?? electionType, inline: true },
          { name: 'Method', value: methodLabels[method] ?? method, inline: true },
          { name: 'Opens', value: `<t:${opensTs}:R>`, inline: true },
        ],
      });

      try {
        await (
          interaction.channel as { send: (opts: unknown) => Promise<unknown> }
        ).send({ embeds: [announceEmbed] });
      } catch {
        // Non-critical announcement — the schedule is recorded regardless.
      }
    }
  },
};

export default command;
