import type { User } from 'discord.js';
import { createEmbed } from './embeds.js';

export type FavourAdjustmentKind = 'grant' | 'remove' | 'spend';

export interface SendFavourAdjustmentDmOptions {
  user: Pick<User, 'send'>;
  kind: FavourAdjustmentKind;
  amount: number;
  categoryName: string;
  categoryEmoji?: string | null;
  balanceAfter: number;
  reason?: string | null;
  characterName?: string | null;
}

function favourWord(amount: number): string {
  return amount === 1 ? 'favour' : 'favours';
}

export async function sendFavourAdjustmentDm({
  user,
  kind,
  amount,
  categoryName,
  categoryEmoji,
  balanceAfter,
  reason,
  characterName,
}: SendFavourAdjustmentDmOptions): Promise<void> {
  const signedAmount = kind === 'grant' ? `+${amount}` : `-${amount}`;
  const emoji = categoryEmoji ? `${categoryEmoji} ` : '';
  const actionLine = {
    grant: `${emoji}You have been granted **${signedAmount}** ${categoryName} ${favourWord(amount)}.`,
    remove: `${emoji}**${signedAmount}** ${categoryName} ${favourWord(amount)} ${amount === 1 ? 'has' : 'have'} been removed from your balance.`,
    spend: `${emoji}**${signedAmount}** ${categoryName} ${favourWord(amount)} ${amount === 1 ? 'has' : 'have'} been spent from your balance.`,
  }[kind];

  const embed = createEmbed({
    title: {
      grant: 'Favours Granted',
      remove: 'Favours Removed',
      spend: 'Favours Spent',
    }[kind],
    description: [
      characterName ? `Character: **${characterName}**` : '',
      actionLine,
      `New balance: \`${balanceAfter}\``,
      reason ? `Reason: ${reason}` : '',
    ].filter(Boolean).join('\n'),
    system: 'favours',
  });

  await user.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

export async function sendFavourAdjustmentDmSafely(
  options: SendFavourAdjustmentDmOptions,
  context: { playerId?: string } = {},
): Promise<boolean> {
  try {
    await sendFavourAdjustmentDm(options);
    return true;
  } catch (err) {
    console.warn('[favour-notify] failed to DM favour adjustment', {
      playerId: context.playerId,
      kind: options.kind,
      categoryName: options.categoryName,
      amount: options.amount,
      err,
    });
    return false;
  }
}
