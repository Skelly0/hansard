import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import type { TicketAccessContext } from '@hansard/api/services/ticketService';
import { db } from '../db.js';
import { isStaff } from './permissions.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface TicketViewerResult {
  viewer: TicketAccessContext | null;
  isStaff: boolean;
  playerId: string | null;
}

export async function getTicketViewer(
  interaction: ChatInputCommandInteraction,
): Promise<TicketViewerResult> {
  const [player] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const actorIsStaff = await isStaff(interaction.member as any);

  if (!player && !actorIsStaff) {
    return { viewer: null, isStaff: false, playerId: null };
  }

  return {
    viewer: {
      userId: player?.id ?? ZERO_UUID,
      isStaff: actorIsStaff,
    },
    isStaff: actorIsStaff,
    playerId: player?.id ?? null,
  };
}

export type TicketPlayerDisplay = {
  discordId: string | null;
  characterName: string | null;
  discordUsername: string;
} | null | undefined;

export function formatTicketPlayer(player: TicketPlayerDisplay, fallback: string): string {
  if (!player) return fallback;
  if (player.discordId) return `<@${player.discordId}>`;
  return player.characterName ?? player.discordUsername ?? fallback;
}
