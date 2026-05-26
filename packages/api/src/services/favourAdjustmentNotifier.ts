import { eq } from 'drizzle-orm';
import { favourCategories, players, type Database } from '@hansard/db';
import { FavourTransactionType, type FavourTransaction } from '@hansard/shared';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const TOKEN_ENV_VARS = 'FAVOUR_DM_BOT_TOKEN or DISCORD_BOT_TOKEN';
const SUPPRESSED_ALLOWED_MENTIONS = { parse: [] } as const;
const FAVOUR_COLOUR = 0xC4873B;

let warnedMissingToken = false;

export interface NotifyFavourAdjustmentOptions {
  db: Database;
  transaction: FavourTransaction;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  footer: { text: string };
}

export async function notifyFavourAdjustment({
  db,
  transaction,
}: NotifyFavourAdjustmentOptions): Promise<boolean> {
  if (!isPlayerFacingAdjustment(transaction.type)) return false;

  const token = getBotToken();
  if (!token) {
    warnMissingToken();
    return false;
  }

  try {
    const [player] = await db
      .select({
        discordId: players.discordId,
        discordUsername: players.discordUsername,
        characterName: players.characterName,
      })
      .from(players)
      .where(eq(players.id, transaction.playerId))
      .limit(1);
    if (!player?.discordId) return false;

    const [category] = await db
      .select({
        name: favourCategories.name,
        emoji: favourCategories.emoji,
      })
      .from(favourCategories)
      .where(eq(favourCategories.id, transaction.categoryId))
      .limit(1);
    if (!category) return false;

    const dmChannelId = await openDmChannel(player.discordId, token);
    if (!dmChannelId) return false;

    return sendDmMessage(dmChannelId, token, {
      embeds: [buildFavourAdjustmentEmbed({
        transaction,
        categoryName: category.name,
        categoryEmoji: category.emoji,
        characterName: player.characterName,
      })],
    });
  } catch (err) {
    console.warn('[favour-notify] failed to send API favour adjustment DM', {
      transactionId: transaction.id,
      playerId: transaction.playerId,
      categoryId: transaction.categoryId,
      err,
    });
    return false;
  }
}

function isPlayerFacingAdjustment(type: FavourTransaction['type']): boolean {
  return type === FavourTransactionType.GRANT
    || type === FavourTransactionType.SPEND
    || type === FavourTransactionType.REMOVE;
}

function getBotToken(): string | undefined {
  return process.env.FAVOUR_DM_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || undefined;
}

function warnMissingToken(): void {
  if (warnedMissingToken) return;
  warnedMissingToken = true;
  console.warn(`notifyFavourAdjustment skipped: set ${TOKEN_ENV_VARS} to DM favour adjustments.`);
}

function buildFavourAdjustmentEmbed({
  transaction,
  categoryName,
  categoryEmoji,
  characterName,
}: {
  transaction: FavourTransaction;
  categoryName: string;
  categoryEmoji: string | null;
  characterName: string | null;
}): DiscordEmbed {
  const amount = Math.abs(transaction.amount);
  const signedAmount = transaction.amount > 0 ? `+${amount}` : `-${amount}`;
  const emoji = categoryEmoji ? `${categoryEmoji} ` : '';
  const actionLine = {
    [FavourTransactionType.GRANT]: `${emoji}You have been granted **${signedAmount}** ${categoryName} ${favourWord(amount)}.`,
    [FavourTransactionType.REMOVE]: `${emoji}**${signedAmount}** ${categoryName} ${favourWord(amount)} ${amount === 1 ? 'has' : 'have'} been removed from your balance.`,
    [FavourTransactionType.SPEND]: `${emoji}**${signedAmount}** ${categoryName} ${favourWord(amount)} ${amount === 1 ? 'has' : 'have'} been spent from your balance.`,
    [FavourTransactionType.SYSTEM]: `${emoji}Your ${categoryName} favour balance changed by **${signedAmount}**.`,
    [FavourTransactionType.TRANSFER]: `${emoji}Your ${categoryName} favour balance changed by **${signedAmount}**.`,
  }[transaction.type];

  return {
    title: {
      [FavourTransactionType.GRANT]: 'Favours Granted',
      [FavourTransactionType.REMOVE]: 'Favours Removed',
      [FavourTransactionType.SPEND]: 'Favours Spent',
      [FavourTransactionType.SYSTEM]: 'Favour Balance Adjusted',
      [FavourTransactionType.TRANSFER]: 'Favour Balance Adjusted',
    }[transaction.type],
    description: [
      characterName ? `Character: **${characterName}**` : '',
      actionLine,
      `New balance: \`${transaction.balanceAfter}\``,
      transaction.reason ? `Reason: ${transaction.reason}` : '',
    ].filter(Boolean).join('\n'),
    color: FAVOUR_COLOUR,
    timestamp: new Date().toISOString(),
    footer: { text: process.env.BOT_DISPLAY_NAME || 'Hansard' },
  };
}

function favourWord(amount: number): string {
  return amount === 1 ? 'favour' : 'favours';
}

async function openDmChannel(discordUserId: string, token: string): Promise<string | null> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`notifyFavourAdjustment DM open failed (${response.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const json = await response.json().catch(() => null) as { id?: string } | null;
  return json?.id ?? null;
}

async function sendDmMessage(
  channelId: string,
  token: string,
  body: { embeds: DiscordEmbed[] },
): Promise<boolean> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      allowed_mentions: SUPPRESSED_ALLOWED_MENTIONS,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`notifyFavourAdjustment DM send failed (${response.status}): ${text.slice(0, 200)}`);
    return false;
  }

  return true;
}
