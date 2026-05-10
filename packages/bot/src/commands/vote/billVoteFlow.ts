import { desc, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog, elections, players } from '@hansard/db';
import {
  BillStatus,
  type ElectionConfig,
  type MajorityType,
  type VotingMethod,
  SUPERMAJORITY_PASS_THRESHOLD,
} from '@hansard/shared';

export interface SubmittedBillSelectRow {
  id: string;
  title: string;
  billNumber: number;
  summary: string | null;
  submittedAt: Date;
}

export interface SubmittedBillSelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface CreateLegislativeBillVoteInput {
  billId: string;
  creatorDiscordId: string;
  title: string;
  description: string | null;
  method: VotingMethod | string;
  majority: MajorityType | string;
  durationHours: number;
  useReactions: boolean;
  now?: Date;
}

export interface CreateLegislativeBillVoteResult {
  bill: {
    id: string;
    status: string;
    playerVoteId: string | null;
  };
  electionId: string;
  votingOpensAt: Date;
  votingClosesAt: Date;
}

const DISCORD_SELECT_LIMIT = 25;
const DISCORD_LABEL_LIMIT = 100;
const DISCORD_DESCRIPTION_LIMIT = 100;

function truncateForDiscord(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatBillNumber(billNumber: number): string {
  return `B-${String(billNumber).padStart(3, '0')}`;
}

export async function listSubmittedBillsForVote(
  database: Database,
): Promise<SubmittedBillSelectRow[]> {
  return database
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      summary: bills.summary,
      submittedAt: bills.submittedAt,
    })
    .from(bills)
    .where(eq(bills.status, BillStatus.SUBMITTED))
    .orderBy(desc(bills.submittedAt))
    .limit(DISCORD_SELECT_LIMIT);
}

export function buildSubmittedBillSelectOptions(
  billRows: SubmittedBillSelectRow[],
): SubmittedBillSelectOption[] {
  return billRows.slice(0, DISCORD_SELECT_LIMIT).map((bill) => {
    const prefix = `${formatBillNumber(bill.billNumber)}: `;
    const label = `${prefix}${truncateForDiscord(
      bill.title,
      DISCORD_LABEL_LIMIT - prefix.length,
    )}`;
    const description = bill.summary
      ? truncateForDiscord(bill.summary, DISCORD_DESCRIPTION_LIMIT)
      : undefined;

    return {
      label,
      value: bill.id,
      ...(description ? { description } : {}),
    };
  });
}

export function buildLegislativeVoteConfig(
  method: VotingMethod | string,
  majority: MajorityType | string,
): ElectionConfig {
  const config: ElectionConfig = {
    anonymousBallots: false,
    sealedResults: false,
  };

  if (method === 'yea_nay_abstain') {
    config.majorityType = majority as MajorityType;
    if (majority === 'supermajority') {
      config.passThreshold = SUPERMAJORITY_PASS_THRESHOLD;
    }
  }

  if (method === 'two_round_runoff' || method === 'fptp') {
    config.runoffEnabled = method === 'two_round_runoff';
    config.runoffThreshold = 0.5;
  }

  return config;
}

export async function createLegislativeBillVote(
  database: Database,
  input: CreateLegislativeBillVoteInput,
): Promise<CreateLegislativeBillVoteResult> {
  if (!Number.isFinite(input.durationHours) || input.durationHours <= 0) {
    throw new Error('Vote duration must be a positive number of hours');
  }

  const [bill] = await database
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      summary: bills.summary,
      status: bills.status,
    })
    .from(bills)
    .where(eq(bills.id, input.billId))
    .limit(1);

  if (!bill) {
    throw new Error('Bill not found');
  }

  if (bill.status !== BillStatus.SUBMITTED) {
    throw new Error(`Bill is not in 'submitted' status (current: ${bill.status})`);
  }

  const [creator] = await database
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, input.creatorDiscordId))
    .limit(1);

  if (!creator) {
    throw new Error('You need a registered character to create a legislature vote.');
  }

  const now = input.now ?? new Date();
  const votingClosesAt = new Date(now.getTime() + input.durationHours * 60 * 60 * 1000);
  const description =
    input.description ??
    bill.summary ??
    `Legislative vote on Bill #${bill.billNumber}: ${bill.title}`;

  return database.transaction(async (tx) => {
    const [election] = await tx
      .insert(elections)
      .values({
        title: input.title,
        description,
        type: 'legislative_vote',
        method: input.method,
        requiredPermission: 'legislative_leader',
        config: buildLegislativeVoteConfig(input.method, input.majority),
        relatedBillId: bill.id,
        createdById: creator.id,
        status: 'voting_open',
        votingOpensAt: now,
        votingClosesAt,
        useReactions: input.useReactions,
      })
      .returning();

    const [updatedBill] = await tx
      .update(bills)
      .set({
        status: BillStatus.VOTING,
        playerVoteId: election.id,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id))
      .returning({
        id: bills.id,
        status: bills.status,
        playerVoteId: bills.playerVoteId,
      });

    if (!updatedBill) {
      throw new Error('Failed to update bill status');
    }

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: bill.status,
      toStatus: BillStatus.VOTING,
      changedById: creator.id,
      notes: `Legislature vote created (election ${election.id})`,
    });

    return {
      bill: updatedBill,
      electionId: election.id,
      votingOpensAt: now,
      votingClosesAt,
    };
  });
}
