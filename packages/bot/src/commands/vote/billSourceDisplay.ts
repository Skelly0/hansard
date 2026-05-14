import type { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, players } from '@hansard/db';
import type { EmbedField } from '../../utils/embeds.js';
import { buildShortBillContentPages } from '../bills/display.js';

export interface BillSourceDisplay {
  fields: EmbedField[];
  embeds: EmbedBuilder[];
}

interface LinkedBillElection {
  type: string;
  relatedBillId: string | null;
}

function emptyBillSourceDisplay(): BillSourceDisplay {
  return { fields: [], embeds: [] };
}

function formatBillNumber(billNumber: number): string {
  return `B-${String(billNumber).padStart(3, '0')}`;
}

export async function buildLinkedBillSourceDisplay(
  database: Database,
  election: LinkedBillElection,
): Promise<BillSourceDisplay> {
  if (election.type !== 'legislative_vote' || !election.relatedBillId) {
    return emptyBillSourceDisplay();
  }

  try {
    const [bill] = await database
      .select({
        title: bills.title,
        billNumber: bills.billNumber,
        authorId: bills.authorId,
        googleDocUrl: bills.googleDocUrl,
        cachedContent: bills.cachedContent,
      })
      .from(bills)
      .where(eq(bills.id, election.relatedBillId))
      .limit(1);

    if (!bill) return emptyBillSourceDisplay();

    const [author] = await database
      .select({
        characterName: players.characterName,
        discordId: players.discordId,
      })
      .from(players)
      .where(eq(players.id, bill.authorId))
      .limit(1);

    const authorName = author?.characterName ?? 'Unknown';
    const authorField: EmbedField = {
      name: 'Author',
      value: author?.discordId ? `${authorName} (<@${author.discordId}>)` : authorName,
      inline: true,
    };

    if (bill.googleDocUrl) {
      return {
        fields: [
          authorField,
          {
            name: 'Bill Text',
            value: `[Google Doc](${bill.googleDocUrl})`,
            inline: false,
          },
        ],
        embeds: [],
      };
    }

    return {
      fields: [
        authorField,
        { name: 'Bill Text', value: 'Short bill text below.', inline: false },
      ],
      embeds: buildShortBillContentPages({
        title: `${formatBillNumber(bill.billNumber)} - ${bill.title}`,
        content: bill.cachedContent ?? '*No short bill text available.*',
      }),
    };
  } catch (error) {
    console.error('[billSourceDisplay] failed to load linked bill source:', error);
    return emptyBillSourceDisplay();
  }
}
