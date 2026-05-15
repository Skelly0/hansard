import type { bills } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';

export interface RepealEmbedInput {
  bill: typeof bills.$inferSelect;
  authorDisplay: string;
  previousStatus: string;
  actorDiscordId: string;
  now: Date;
}

/**
 * Embed used to edit the original `/bill enact` post in place. Keeps the bill
 * title + doc link as a historical anchor and overlays a 🚫 REPEALED banner.
 */
export function buildRepealEditEmbed(input: RepealEmbedInput) {
  const { bill, authorDisplay, actorDiscordId, now } = input;
  const padded = String(bill.billNumber).padStart(3, '0');
  const repealedTimestamp = Math.floor(now.getTime() / 1000);
  const enactedTimestamp = bill.enactedAt
    ? Math.floor(bill.enactedAt.getTime() / 1000)
    : null;

  const summaryBlock = bill.summary
    ? `\n\n> ${bill.summary.replace(/\n/g, '\n> ')}`
    : '';
  const sourceLink = bill.googleDocUrl
    ? `\n\n[\u{1F4D6} Read the full text](${bill.googleDocUrl})`
    : '';
  const enactedLine = enactedTimestamp
    ? `\n~~**Bill #B-${padded}** was enacted as law on <t:${enactedTimestamp}:F>.~~`
    : `\n~~**Bill #B-${padded}** was enacted as law.~~`;

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Author', value: authorDisplay, inline: true },
    { name: 'Status', value: '\u{1F6AB} Repealed', inline: true },
  ];
  if (bill.tags?.length) {
    fields.push({ name: 'Tags', value: bill.tags.join(' · '), inline: true });
  }
  if (bill.policyAreas?.length) {
    fields.push({ name: 'Policy Areas', value: bill.policyAreas.join(' · '), inline: true });
  }

  return createEmbed({
    title: `\u{1F6AB} [REPEALED] ${bill.title}`,
    url: bill.googleDocUrl ?? undefined,
    system: 'bills',
    description: [
      `\u{1F6AB} **This law has been repealed.**`,
      enactedLine,
      `${summaryBlock}${sourceLink}`,
      '',
      `*Repealed by <@${actorDiscordId}> · <t:${repealedTimestamp}:F>*`,
    ].join('\n'),
    fields,
  });
}

/**
 * Standalone "Bill Repealed" announcement used as a fallback when the original
 * legislation embed cannot be edited (legacy bill with no stored message id,
 * channel/message no longer reachable, etc.).
 */
export function buildRepealFallbackEmbed(input: RepealEmbedInput) {
  const { bill, authorDisplay, previousStatus, actorDiscordId, now } = input;
  const padded = String(bill.billNumber).padStart(3, '0');
  const repealedTimestamp = Math.floor(now.getTime() / 1000);
  const summaryBlock = bill.summary
    ? `\n\n> ${bill.summary.replace(/\n/g, '\n> ')}`
    : '';
  const sourceLink = bill.googleDocUrl
    ? `\n\n[\u{1F4D6} Read the full text](${bill.googleDocUrl})`
    : '';

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Author', value: authorDisplay, inline: true },
    { name: 'Previous status', value: `\`${previousStatus}\``, inline: true },
  ];
  if (bill.tags?.length) {
    fields.push({ name: 'Tags', value: bill.tags.join(' · '), inline: true });
  }
  if (bill.policyAreas?.length) {
    fields.push({ name: 'Policy Areas', value: bill.policyAreas.join(' · '), inline: true });
  }

  return createEmbed({
    title: bill.title,
    url: bill.googleDocUrl ?? undefined,
    system: 'bills',
    description: [
      `\u{1F6AB} **Bill #B-${padded}** has been **repealed** and is no longer law.${summaryBlock}${sourceLink}`,
      '',
      `*Repealed by <@${actorDiscordId}> · <t:${repealedTimestamp}:F>*`,
    ].join('\n'),
    fields,
  });
}
