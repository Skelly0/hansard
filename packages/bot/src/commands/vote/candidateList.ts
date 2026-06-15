import type { ChatInputCommandInteraction } from 'discord.js';
import { and, eq, inArray } from 'drizzle-orm';
import { candidates, players, parties } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote candidate-list election:<title-or-id> — list all (non-withdrawn)
 * candidates in an election with their party/faction.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const electionRef = interaction.options.getString('election', true);
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));

    // 1. Look up election by title or ID
    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election || (election.status === 'draft' && !actorIsStaff)) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    // 2. Fetch active candidates
    const rows = await db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.electionId, election.id),
          eq(candidates.isWithdrawn, false),
        ),
      )
      .orderBy(candidates.registeredAt, candidates.id);

    if (rows.length === 0) {
      const empty = createEmbed({
        title: `Candidates: ${election.title}`,
        description: '*No candidates have registered yet.*',
        system: 'voting',
        fields: [
          { name: 'Status', value: election.status, inline: true },
          { name: 'Round', value: String(election.roundNumber), inline: true },
        ],
      });
      await interaction.editReply({ embeds: [empty] });
      return;
    }

    // 3. Resolve player + party display names in batch
    const playerIds = rows.map((c) => c.playerId);
    const partyIds = rows.map((c) => c.partyId).filter((id): id is string => id != null);

    const playerRows = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(inArray(players.id, playerIds));

    const partyRows = partyIds.length > 0
      ? await db
          .select({ id: parties.id, name: parties.name })
          .from(parties)
          .where(inArray(parties.id, partyIds))
      : [];

    const playerMap = new Map(playerRows.map((p) => [p.id, p.characterName ?? p.discordUsername]));
    const partyMap = new Map(partyRows.map((p) => [p.id, p.name]));

    const lines = rows.map((c, i) => {
      const name = playerMap.get(c.playerId) ?? c.playerId;
      const party = c.partyId ? partyMap.get(c.partyId) ?? 'Unknown Party' : 'Independent';
      return `**${i + 1}.** ${name} — *${party}*`;
    });

    const embed = createEmbed({
      title: `Candidates: ${election.title}`,
      description: lines.join('\n'),
      system: 'voting',
      fields: [
        { name: 'Total', value: String(rows.length), inline: true },
        { name: 'Status', value: election.status, inline: true },
        { name: 'Round', value: String(election.roundNumber), inline: true },
      ],
    });

  await interaction.editReply({ embeds: [embed] });
}
