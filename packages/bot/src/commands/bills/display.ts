import type { EmbedBuilder } from 'discord.js';
import { createEmbed, type EmbedField } from '../../utils/embeds.js';

export const BILL_CONTENT_PAGE_SIZE = 1800;
export const SHORT_BILL_TEXT_MAX_LENGTH = 4000;

export function splitBillTextForDiscord(
  content: string,
  maxLength = BILL_CONTENT_PAGE_SIZE,
): string[] {
  let remaining = content.trim();
  if (!remaining) return ['*No bill text available.*'];

  const chunks: string[] = [];

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    let splitAt = window.lastIndexOf('\n\n');

    if (splitAt < maxLength * 0.5) {
      splitAt = window.lastIndexOf('\n');
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = window.lastIndexOf(' ');
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

export function buildShortBillContentPages(options: {
  title: string;
  content: string;
  fields?: EmbedField[];
}): EmbedBuilder[] {
  const chunks = splitBillTextForDiscord(options.content);

  return chunks.map((chunk, index) => createEmbed({
    title: index === 0 ? options.title : `${options.title} (continued)`,
    description: chunk,
    system: 'bills',
    fields: index === 0 ? options.fields : undefined,
  }));
}
