import type { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills } from '@hansard/db';
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
        googleDocUrl: bills.googleDocUrl,
        cachedContent: bills.cachedContent,
      })
      .from(bills)
      .where(eq(bills.id, election.relatedBillId))
      .limit(1);

    if (!bill) return emptyBillSourceDisplay();

    if (bill.googleDocUrl) {
      return {
        fields: [{
          name: 'Bill Text',
          value: `[Google Doc](${bill.googleDocUrl})`,
          inline: false,
        }],
        embeds: [],
      };
    }

    return {
      fields: [{ name: 'Bill Text', value: 'Short bill text below.', inline: false }],
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
