import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type User,
} from 'discord.js';
import { eq, inArray } from 'drizzle-orm';
import { candidates, elections, offices, players } from '@hansard/db';
import {
  DEFAULT_VOTE_DURATION_HOURS,
  REACTION_COMPATIBLE_METHODS,
  REACTION_FPTP_MAX_CANDIDATES,
} from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { hasPermission } from '../../utils/permissions.js';
import { autocompleteOffice } from '../office/_officeAutocomplete.js';
import { wakeVoteAutoCloseWorker } from '../../services/voteAutoClose.js';
import { getRequestedVoteInterface } from './_electionReference.js';
import { seedAllReactionsForOpenVote } from './_seedFptpReactions.js';

const DEFAULT_NOMINATIONS_HOURS = 48;
const MAX_DIRECT_CANDIDATES = 10;
const HOUR_MS = 60 * 60 * 1000;

type DirectCandidatePlayer = {
  id: string;
  discordId: string;
  discordUsername: string;
  characterName: string | null;
  partyId: string | null;
  isAlive: boolean;
};

/**
 * /vote elect <office> [method] — Create a position election.
 *
 * Chancellor-only command. Creates an election with type 'position_election'
 * linked to the specified office. Candidates can submit themselves, or the
 * creator can provide direct candidate slots to skip nominations and open the
 * vote immediately.
 *
 * Example: /vote elect office:Archon method:fptp candidate-1:@Ada
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Permission check — requires legislative_leader or staff
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    const permitted = await hasPermission(member as any, 'voting.create');
    if (!permitted) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can create position elections.')],
        ephemeral: true,
      });
      return;
    }

    const officeName = interaction.options.getString('office', true).trim();
    const method = interaction.options.getString('method') ?? 'fptp';
    const iface = getRequestedVoteInterface(interaction.options.getString('interface'), method);
    const useReactions = iface === 'reactions';
    const nominationsHours = interaction.options.getNumber('nominations-hours') ?? DEFAULT_NOMINATIONS_HOURS;
    const votingHours = interaction.options.getNumber('duration-hours') ?? DEFAULT_VOTE_DURATION_HOURS;
    const directCandidateUsers = getDirectCandidateUsers(interaction);
    const skipNominationsRequested = interaction.options.getBoolean('skip-nominations') ?? false;
    const skipNominations = skipNominationsRequested || directCandidateUsers.length > 0;

    if (useReactions && !REACTION_COMPATIBLE_METHODS.includes(method as never)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `Reaction-mode voting is only supported for **First Past the Post** position elections. Method \`${method}\` requires buttons/web ballots.`,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (!Number.isFinite(nominationsHours) || nominationsHours <= 0) {
      await interaction.reply({
        embeds: [errorEmbed('`nominations-hours` must be a positive number.')],
        ephemeral: true,
      });
      return;
    }

    if (!Number.isFinite(votingHours) || votingHours <= 0) {
      await interaction.reply({
        embeds: [errorEmbed('`duration-hours` must be a positive number.')],
        ephemeral: true,
      });
      return;
    }

    if (skipNominations && directCandidateUsers.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('Add at least one `candidate-*` user when skipping nominations.')],
        ephemeral: true,
      });
      return;
    }

    if (useReactions && directCandidateUsers.length > REACTION_FPTP_MAX_CANDIDATES) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `Reaction-mode FPTP supports at most ${REACTION_FPTP_MAX_CANDIDATES} candidates. Use \`interface:Buttons\` for a larger ballot.`,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const allOffices = await db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(eq(offices.isActive, true));
    const office = allOffices.find((o) => o.name.toLowerCase() === officeName.toLowerCase())
      ?? allOffices.find((o) => o.name.toLowerCase().includes(officeName.toLowerCase()));

    if (!office) {
      await interaction.reply({
        embeds: [errorEmbed(`Office "${officeName}" not found.`)],
        ephemeral: true,
      });
      return;
    }

    let directCandidatePlayers: DirectCandidatePlayer[] = [];
    if (directCandidateUsers.length > 0) {
      const candidateDiscordIds = directCandidateUsers.map((user) => user.id);
      const rows = await db
        .select({
          id: players.id,
          discordId: players.discordId,
          discordUsername: players.discordUsername,
          characterName: players.characterName,
          partyId: players.partyId,
          isAlive: players.isAlive,
        })
        .from(players)
        .where(inArray(players.discordId, candidateDiscordIds));

      const byDiscordId = new Map(rows.map((player) => [player.discordId, player]));
      const missing = directCandidateUsers.filter((user) => !byDiscordId.has(user.id));
      if (missing.length > 0) {
        await interaction.reply({
          embeds: [errorEmbed(`These candidate users are not registered players: ${missing.map((user) => `<@${user.id}>`).join(', ')}`)],
          ephemeral: true,
        });
        return;
      }

      const withoutCharacters = directCandidateUsers.filter((user) => !byDiscordId.get(user.id)?.characterName);
      if (withoutCharacters.length > 0) {
        await interaction.reply({
          embeds: [errorEmbed(`These candidates need characters before they can stand: ${withoutCharacters.map((user) => `<@${user.id}>`).join(', ')}`)],
          ephemeral: true,
        });
        return;
      }

      const deadCharacters = directCandidateUsers.filter((user) => byDiscordId.get(user.id)?.isAlive === false);
      if (deadCharacters.length > 0) {
        await interaction.reply({
          embeds: [errorEmbed(`Dead characters cannot stand as candidates: ${deadCharacters.map((user) => `<@${user.id}>`).join(', ')}`)],
          ephemeral: true,
        });
        return;
      }

      directCandidatePlayers = directCandidateUsers.map((user) => byDiscordId.get(user.id)!);
    }

    const [creator] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!creator) {
      await interaction.reply({
        embeds: [errorEmbed('You are not registered as a player.')],
        ephemeral: true,
      });
      return;
    }

    const now = new Date();
    const nominationsCloseAt = skipNominations
      ? now
      : new Date(now.getTime() + nominationsHours * HOUR_MS);
    const votingOpensAt = skipNominations ? now : nominationsCloseAt;
    const votingClosesAt = new Date(votingOpensAt.getTime() + votingHours * HOUR_MS);
    const status = skipNominations ? 'voting_open' : 'nominations_open';

    let electionId: string;
    try {
      electionId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(elections)
          .values({
            title: `Election: ${office.name}`,
            type: 'position_election',
            method,
            config: { runoffEnabled: method === 'two_round_runoff', runoffThreshold: 0.5 } as any,
            forOfficeId: office.id,
            nominationsOpenAt: now,
            nominationsCloseAt,
            votingOpensAt,
            votingClosesAt,
            status,
            createdById: creator.id,
            useReactions,
          })
          .returning({ id: elections.id });

        if (!row) {
          throw new Error('Failed to create election');
        }

        if (directCandidatePlayers.length > 0) {
          await tx.insert(candidates).values(
            directCandidatePlayers.map((player, index) => ({
              electionId: row.id,
              playerId: player.id,
              partyId: player.partyId ?? null,
              nominatedById: creator.id,
              registeredAt: new Date(now.getTime() + index),
            })),
          );
        }

        return row.id;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create election';
      await interaction.reply({ embeds: [errorEmbed(message)], ephemeral: true });
      return;
    }

    const candidateLines = directCandidatePlayers.map((player, index) =>
      `**${index + 1}.** ${player.characterName ?? player.discordUsername}`,
    );
    const nominationsValue = skipNominations
      ? 'Skipped'
      : `${formatDiscordTimestamp(now)} -> ${formatDiscordTimestamp(nominationsCloseAt)}`;
    const votingValue = `${formatDiscordTimestamp(votingOpensAt)} -> ${formatDiscordTimestamp(votingClosesAt)}`;

    const embed = createEmbed({
      title: `Position Election: ${office.name}`,
      description: [
        `A position election has been created for **${office.name}**.`,
        '',
        `**Method:** ${method}`,
        `**Status:** ${skipNominations ? 'Voting Open' : 'Nominations Open'}`,
        `**Interface:** ${useReactions ? 'Discord reactions' : 'Buttons'}`,
        '',
        skipNominations
          ? 'The ballot has been opened with the selected candidates.'
          : 'Candidates can submit themselves using `/vote candidate-submit`.',
        skipNominations
          ? (useReactions ? 'Vote by reacting to this message once candidate emoji are seeded.' : 'Vote with `/vote cast`.')
          : 'Staff can run `/vote open` after nominations close.',
      ].join('\n'),
      system: 'voting',
      fields: [
        { name: 'Office', value: office.name, inline: true },
        { name: 'Method', value: method, inline: true },
        { name: 'Status', value: skipNominations ? 'Voting Open' : 'Nominations Open', inline: true },
        { name: 'Interface', value: useReactions ? 'Discord reactions' : 'Buttons', inline: true },
        { name: 'Nominations', value: nominationsValue, inline: false },
        { name: 'Voting Window', value: votingValue, inline: false },
        ...(candidateLines.length > 0
          ? [{ name: `Candidates (${candidateLines.length})`, value: candidateLines.join('\n'), inline: false }]
          : []),
        { name: 'Election ID', value: `\`${electionId}\``, inline: false },
      ],
    });

    if (useReactions) {
      let publicReplyPosted = false;
      try {
        const posted = await interaction.reply({ embeds: [embed], fetchReply: true });
        publicReplyPosted = true;
        await db
          .update(elections)
          .set({
            discordMessageId: posted.id,
            discordChannelId: posted.channelId,
            updatedAt: new Date(),
          })
          .where(eq(elections.id, electionId));

        if (skipNominations && method === 'fptp') {
          const result = await seedAllReactionsForOpenVote({
            client: interaction.client,
            electionId,
            channelId: posted.channelId,
            messageId: posted.id,
          });

          if (result.overflow) {
            await interaction.followUp({
              embeds: [
                errorEmbed(
                  `Warning: this election has ${result.totalCandidates} candidates, but reaction mode supports only ${REACTION_FPTP_MAX_CANDIDATES}. Use buttons for larger FPTP ballots.`,
                ),
              ],
              ephemeral: true,
            });
          }
        }
      } catch (error) {
        await cancelElectionAfterReactionSetupFailure(electionId);
        const message = error instanceof Error ? error.message : 'Failed to attach reaction voting message';
        const payload = {
          embeds: [
            errorEmbed(
              `Reaction voting could not be attached to this election (${message}). The election has been cancelled so it is not left open without a working vote message.`,
            ),
          ],
          ephemeral: true,
        };

        try {
          if (publicReplyPosted) {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        } catch (notifyError) {
          console.error('[vote-elect] failed to notify creator after reaction setup failure:', notifyError);
        }
        return;
      }

      if (skipNominations) {
        wakeVoteAutoCloseWorker('position-election-opened');
      }
      return;
    }

    if (skipNominations) {
      wakeVoteAutoCloseWorker('position-election-opened');
    }

    await interaction.reply({ embeds: [embed] });
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteOffice(interaction);
}

function getDirectCandidateUsers(interaction: ChatInputCommandInteraction): User[] {
  const seen = new Set<string>();
  const users: User[] = [];

  for (let index = 1; index <= MAX_DIRECT_CANDIDATES; index += 1) {
    const user = interaction.options.getUser(`candidate-${index}`);
    if (!user || seen.has(user.id)) continue;
    seen.add(user.id);
    users.push(user);
  }

  return users;
}

function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function cancelElectionAfterReactionSetupFailure(electionId: string): Promise<void> {
  try {
    await db
      .update(elections)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(elections.id, electionId));
  } catch (error) {
    console.error(`[vote-elect] failed to cancel election ${electionId} after reaction setup failure:`, error);
  }
}
