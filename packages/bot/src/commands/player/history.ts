import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, inArray, ne, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/** Number of events per page. */
const EVENTS_PER_PAGE = 8;
const PUBLIC_PLAYER_EVENT_TYPES: PlayerEventType[] = [
  PlayerEventType.PARTY_CHANGE,
  PlayerEventType.FACTION_CHANGE,
  PlayerEventType.OFFICE_APPOINTED,
  PlayerEventType.OFFICE_LEFT,
  PlayerEventType.DEATH,
  PlayerEventType.REGISTRATION,
  PlayerEventType.NAME_CHANGE,
];

/** Emoji mapping for event types. */
const EVENT_TYPE_EMOJI: Record<string, string> = {
  registration: '\u{1F4DD}',       // memo
  party_change: '\u{1F3DB}\u{FE0F}', // classical building
  faction_change: '\u{2694}\u{FE0F}', // crossed swords
  office_appointed: '\u{1F451}',    // crown
  office_left: '\u{1F44B}',         // waving hand
  ailment_acquired: '\u{1FA7A}',    // stethoscope
  ailment_recovered: '\u{1F49A}',   // green heart
  health_changed: '\u{2764}\u{FE0F}\u{200D}\u{1FA79}', // mending heart
  death: '\u{26B0}\u{FE0F}',        // coffin
  name_change: '\u{1F4AC}',         // speech bubble
  profile_edit: '\u{270F}\u{FE0F}', // pencil
  suspension: '\u{26D4}',           // no entry
  unsuspension: '\u{2705}',         // check mark
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View a player\'s event log')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The player to view history for (defaults to yourself)')
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));
    const actorIsSelf = targetUser.id === interaction.user.id;

    // Fetch the player
    const playerRows = await db
      .select({ id: players.id, characterName: players.characterName })
      .from(players)
      .where(eq(players.discordId, targetUser.id))
      .limit(1);

    if (playerRows.length === 0 || !playerRows[0].characterName) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            targetUser.id === interaction.user.id
              ? 'You haven\'t created a character yet. Use `/character create` to get started.'
              : `**${targetUser.displayName}** hasn't created a character yet.`,
          ),
        ],
      });
      return;
    }

    const player = playerRows[0];

    // Fetch all events for this player, ordered by most recent
    const conditions: SQL[] = [eq(playerEventLog.playerId, player.id)];
    if (!actorIsStaff) {
      conditions.push(
        actorIsSelf
          ? ne(playerEventLog.eventType, PlayerEventType.DEATH_PENDING)
          : inArray(playerEventLog.eventType, PUBLIC_PLAYER_EVENT_TYPES),
      );
    }

    const events = await db
      .select()
      .from(playerEventLog)
      .where(and(...conditions))
      .orderBy(desc(playerEventLog.createdAt));

    if (events.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: `History: ${player.characterName}`,
            description: '*No events recorded yet.*',
            system: 'players',
          }),
        ],
      });
      return;
    }

    // Build paginated embeds
    const totalPages = Math.ceil(events.length / EVENTS_PER_PAGE);
    const pages: EmbedBuilder[] = [];

    for (let page = 0; page < totalPages; page++) {
      const pageEvents = events.slice(
        page * EVENTS_PER_PAGE,
        (page + 1) * EVENTS_PER_PAGE,
      );

      const lines = pageEvents.map((event) => {
        const emoji = EVENT_TYPE_EMOJI[event.eventType] ?? '\u{1F4C4}'; // default: page facing up
        const timestamp = event.createdAt
          ? `<t:${Math.floor(event.createdAt.getTime() / 1000)}:R>`
          : 'Unknown time';
        const simDate = event.simDate ? ` (Sim: ${event.simDate})` : '';
        const auto = event.isAutomatic ? ' *(auto)*' : '';

        return `${emoji} **${event.eventType.replace(/_/g, ' ')}** — ${timestamp}${simDate}${auto}\n> ${event.description}`;
      });

      const embed = createEmbed({
        title: `History: ${player.characterName}`,
        description: lines.join('\n\n'),
        system: 'players',
        fields: [
          {
            name: 'Total Events',
            value: `${events.length} event${events.length === 1 ? '' : 's'}`,
            inline: true,
          },
        ],
      });

      pages.push(embed);
    }

    await createPaginatedEmbed({
      interaction,
      pages,
    });
  },
};

export default command;
