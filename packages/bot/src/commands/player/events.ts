import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, and, desc, inArray, ne, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

const EVENT_LIMIT = 10;
const PUBLIC_PLAYER_EVENT_TYPES: PlayerEventType[] = [
  PlayerEventType.PARTY_CHANGE,
  PlayerEventType.FACTION_CHANGE,
  PlayerEventType.OFFICE_APPOINTED,
  PlayerEventType.OFFICE_LEFT,
  PlayerEventType.DEATH,
  PlayerEventType.REGISTRATION,
  PlayerEventType.NAME_CHANGE,
];

const EVENT_TYPE_EMOJI: Record<string, string> = {
  registration: '\u{1F4DD}',
  party_change: '\u{1F3DB}\u{FE0F}',
  faction_change: '\u{2694}\u{FE0F}',
  office_appointed: '\u{1F451}',
  office_left: '\u{1F44B}',
  ailment_acquired: '\u{1FA7A}',
  ailment_recovered: '\u{1F49A}',
  health_changed: '\u{2764}\u{FE0F}',
  death: '\u{26B0}\u{FE0F}',
  name_change: '\u{1F4AC}',
  suspension: '\u{26D4}',
  unsuspension: '\u{2705}',
};

// Build slash-command choices from the PlayerEventType enum so they stay in sync.
export const TYPE_CHOICES = Object.values(PlayerEventType).map((value) => ({
  name: value.replace(/_/g, ' '),
  value,
})) as { name: string; value: string }[];

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user', true);
    const eventType = interaction.options.getString('type');
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));
    const actorIsSelf = targetUser.id === interaction.user.id;

    const [player] = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        characterPortraitUrl: players.characterPortraitUrl,
      })
      .from(players)
      .where(eq(players.discordId, targetUser.id))
      .limit(1);

    if (!player || !player.characterName) {
      await interaction.editReply({
        embeds: [
          errorEmbed(`**${targetUser.displayName}** has not registered a character yet.`),
        ],
      });
      return;
    }

    const conditions: SQL[] = [eq(playerEventLog.playerId, player.id)];
    if (eventType) {
      conditions.push(eq(playerEventLog.eventType, eventType));
    }
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
      .orderBy(desc(playerEventLog.createdAt))
      .limit(EVENT_LIMIT);

    if (events.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: `Events: ${player.characterName}`,
            description: eventType
              ? `*No \`${eventType}\` events recorded.*`
              : '*No events recorded yet.*',
            system: 'players',
          }),
        ],
      });
      return;
    }

    const lines = events.map((event) => {
      const emoji = EVENT_TYPE_EMOJI[event.eventType] ?? '\u{1F4C4}';
      const ts = event.createdAt
        ? `<t:${Math.floor(event.createdAt.getTime() / 1000)}:R>`
        : 'unknown';
      const simDate = event.simDate ? ` (Sim: ${event.simDate})` : '';
      const auto = event.isAutomatic ? ' *(auto)*' : '';
      return `${emoji} **${event.eventType.replace(/_/g, ' ')}** — ${ts}${simDate}${auto}\n> ${event.description}`;
    });

    const embed = createEmbed({
      title: `Events: ${player.characterName}`,
      description: lines.join('\n\n'),
      system: 'players',
      thumbnail: player.characterPortraitUrl ?? undefined,
      fields: [
        {
          name: 'Showing',
          value: `Last ${events.length}${eventType ? ` \`${eventType}\`` : ''} event${events.length === 1 ? '' : 's'}`,
          inline: true,
        },
      ],
    });

  await interaction.editReply({ embeds: [embed] });
}
