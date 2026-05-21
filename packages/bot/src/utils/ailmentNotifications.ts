import type { Client, User } from 'discord.js';
import { inArray } from 'drizzle-orm';
import { players, type Database } from '@hansard/db';
import { createEmbed } from './embeds.js';

export interface AilmentNotification {
  playerId: string;
  characterName?: string | null;
  condition: string;
  severity: string;
}

export interface AilmentDmResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface SendAilmentDmOptions {
  user: Pick<User, 'send'>;
  characterName?: string | null;
  condition: string;
  severity: string;
}

export async function sendAilmentDm({
  user,
  characterName,
  condition,
  severity,
}: SendAilmentDmOptions): Promise<void> {
  const embed = createEmbed({
    title: 'Health Update',
    description: [
      `Your character${characterName ? `, **${characterName}**` : ''}, has developed a new ailment.`,
      '',
      `**Condition:** ${condition}`,
      `**Severity:** ${severity}`,
    ].join('\n'),
    system: 'simulation',
  });

  await user.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

export async function sendAilmentDmSafely(
  options: SendAilmentDmOptions,
  context: { playerId?: string } = {},
): Promise<boolean> {
  try {
    await sendAilmentDm(options);
    return true;
  } catch (err) {
    console.warn('[ailment-notify] failed to DM ailment acquisition', {
      playerId: context.playerId,
      condition: options.condition,
      severity: options.severity,
      err,
    });
    return false;
  }
}

export async function notifyAilmentDms({
  client,
  db,
  ailments,
}: {
  client: Pick<Client, 'users'>;
  db: Database;
  ailments: AilmentNotification[];
}): Promise<AilmentDmResult> {
  const result: AilmentDmResult = {
    attempted: ailments.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  if (ailments.length === 0) return result;

  const playerIds = Array.from(new Set(ailments.map((ailment) => ailment.playerId)));
  const playerRows = await db
    .select({
      id: players.id,
      discordId: players.discordId,
      characterName: players.characterName,
    })
    .from(players)
    .where(inArray(players.id, playerIds));
  const playersById = new Map(playerRows.map((player) => [player.id, player]));

  for (const ailment of ailments) {
    const player = playersById.get(ailment.playerId);
    if (!player?.discordId) {
      result.skipped += 1;
      continue;
    }

    try {
      const user = await client.users.fetch(player.discordId);
      const sent = await sendAilmentDmSafely({
        user,
        characterName: ailment.characterName ?? player.characterName,
        condition: ailment.condition,
        severity: ailment.severity,
      }, { playerId: ailment.playerId });

      if (sent) {
        result.sent += 1;
      } else {
        result.failed += 1;
      }
    } catch (err) {
      console.warn('[ailment-notify] failed to fetch Discord user for ailment acquisition', {
        playerId: ailment.playerId,
        discordId: player.discordId,
        condition: ailment.condition,
        severity: ailment.severity,
        err,
      });
      result.failed += 1;
    }
  }

  return result;
}

