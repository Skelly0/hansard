import type { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, players } from '@hansard/db';
import { BillStatus, ElectionType } from '@hansard/shared';
import { createEmbed } from '../../utils/embeds.js';
import { postLegislationEmbed, type LegislationPostResult } from '../../utils/legislationChannel.js';
import { enactBill } from './enactFlow.js';

type LegislationClient = {
  channels: {
    fetch(channelId: string): Promise<unknown>;
  };
};

type AutoEnactElection = {
  id: string;
  type: string;
  relatedBillId: string | null;
  createdById: string;
};

type EnactableBill = typeof bills.$inferSelect;

export type AutoEnactResult =
  | {
      status: 'skipped';
      reason: string;
      billId?: string;
    }
  | {
      status: 'enacted';
      billId: string;
      postResult: LegislationPostResult;
    };

function formatAuthorDisplay(author: { characterName: string | null; discordId: string | null } | undefined): string {
  const authorName = author?.characterName ?? 'Unknown';
  return author?.discordId ? `${authorName} (<@${author.discordId}>)` : authorName;
}

function buildEnactedByLine({
  actorDiscordId,
  automatic,
  timestamp,
}: {
  actorDiscordId?: string | null;
  automatic?: boolean;
  timestamp: number;
}): string {
  if (!automatic) {
    return actorDiscordId
      ? `*Enacted by <@${actorDiscordId}> · <t:${timestamp}:F>*`
      : `*Enacted at <t:${timestamp}:F>*`;
  }

  return actorDiscordId
    ? `*Enacted automatically after player-house passage · triggered by <@${actorDiscordId}> · <t:${timestamp}:F>*`
    : `*Enacted automatically after player-house passage · <t:${timestamp}:F>*`;
}

export function buildBillEnactmentEmbed({
  bill,
  authorDisplay,
  actorDiscordId,
  automatic = false,
  now,
}: {
  bill: EnactableBill;
  authorDisplay: string;
  actorDiscordId?: string | null;
  automatic?: boolean;
  now: Date;
}): EmbedBuilder {
  const padded = String(bill.billNumber).padStart(3, '0');
  const enactedTimestamp = Math.floor(now.getTime() / 1000);
  const summaryBlock = bill.summary
    ? `\n\n> ${bill.summary.replace(/\n/g, '\n> ')}`
    : '';
  const sourceLink = bill.googleDocUrl
    ? `\n\n[\u{1F4D6} Read the full text](${bill.googleDocUrl})`
    : '';

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Author', value: authorDisplay, inline: true },
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
      `**Bill #B-${padded}** has been enacted and is now law.${summaryBlock}${sourceLink}`,
      '',
      buildEnactedByLine({ actorDiscordId, automatic, timestamp: enactedTimestamp }),
    ].join('\n'),
    fields,
  });
}

export async function enactAndPostBill({
  database,
  client,
  bill,
  authorDisplay,
  changedById,
  actorDiscordId,
  now = new Date(),
  automatic = false,
  auditNote,
  logger = console,
}: {
  database: Database;
  client: LegislationClient;
  bill: EnactableBill;
  authorDisplay: string;
  changedById: string;
  actorDiscordId?: string | null;
  now?: Date;
  automatic?: boolean;
  auditNote?: string;
  logger?: Pick<Console, 'error'>;
}): Promise<{ embed: EmbedBuilder; postResult: LegislationPostResult }> {
  await enactBill(database, {
    billId: bill.id,
    expectedStatus: bill.status,
    changedById,
    actorDiscordId: actorDiscordId ?? undefined,
    auditNote,
    now,
  });

  const embed = buildBillEnactmentEmbed({
    bill,
    authorDisplay,
    actorDiscordId,
    automatic,
    now,
  });

  const postResult = await postLegislationEmbed({ client, embed });

  if (postResult.status === 'sent' && postResult.messageId && postResult.channelId) {
    try {
      await database
        .update(bills)
        .set({
          legislationChannelId: postResult.channelId,
          legislationMessageId: postResult.messageId,
          updatedAt: new Date(),
        })
        .where(eq(bills.id, bill.id));
    } catch (error) {
      logger.error('Failed to persist legislation message id for bill', bill.id, error);
    }
  }

  return { embed, postResult };
}

export async function autoEnactPassedBillFromElection({
  database,
  client,
  election,
  now = new Date(),
}: {
  database: Database;
  client: LegislationClient;
  election: AutoEnactElection;
  now?: Date;
}): Promise<AutoEnactResult> {
  if (election.type !== ElectionType.LEGISLATIVE_VOTE || !election.relatedBillId) {
    return { status: 'skipped', reason: 'not_linked_legislative_vote' };
  }

  const [bill] = await database
    .select()
    .from(bills)
    .where(eq(bills.id, election.relatedBillId))
    .limit(1);

  if (!bill) {
    return { status: 'skipped', reason: 'bill_not_found', billId: election.relatedBillId };
  }

  if (bill.status !== BillStatus.PLAYER_PASSED) {
    return { status: 'skipped', reason: `bill_status_${bill.status}`, billId: bill.id };
  }

  const [author] = await database
    .select({
      characterName: players.characterName,
      discordId: players.discordId,
    })
    .from(players)
    .where(eq(players.id, bill.authorId))
    .limit(1);

  const [actor] = await database
    .select({ discordId: players.discordId })
    .from(players)
    .where(eq(players.id, election.createdById))
    .limit(1);

  const { postResult } = await enactAndPostBill({
    database,
    client,
    bill,
    authorDisplay: formatAuthorDisplay(author),
    changedById: election.createdById,
    actorDiscordId: actor?.discordId ?? null,
    automatic: true,
    auditNote: `Auto-enacted after player-house passage (election ${election.id})`,
    now,
  });

  return { status: 'enacted', billId: bill.id, postResult };
}
