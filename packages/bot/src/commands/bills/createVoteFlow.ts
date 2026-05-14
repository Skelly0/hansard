import { and, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog, elections } from '@hansard/db';
import { BillStatus, DEFAULT_VOTE_DURATION_MS } from '@hansard/shared';

export interface CreateLegislativeVoteInput {
  billId: string;
  billTitle: string;
  billNumber: number;
  billSummary: string | null;
  expectedStatus: string;
  createdById: string;
  now?: Date;
}

export interface CreateLegislativeVoteResult {
  election: {
    id: string;
    title: string;
    description: string;
    votingOpensAt: Date;
    votingClosesAt: Date;
  };
  bill: {
    id: string;
    status: string;
    playerVoteId: string;
  };
  previousBillStatus: string;
}

/**
 * Transactionally open a legislative vote on a submitted bill:
 *  1. insert the election row
 *  2. flip the bill to `voting` and set `playerVoteId`
 *  3. append a `bill_status_log` audit row
 *
 * Any failure rolls back all three writes so we can't end up with an
 * orphan election, an out-of-sync bill, or a missing audit row.
 */
export async function createLegislativeVoteForBill(
  database: Database,
  input: CreateLegislativeVoteInput,
): Promise<CreateLegislativeVoteResult> {
  const now = input.now ?? new Date();
  const votingCloses = new Date(now.getTime() + DEFAULT_VOTE_DURATION_MS);
  const previousStatus = input.expectedStatus;

  return database.transaction(async (tx) => {
    const [election] = await tx
      .insert(elections)
      .values({
        title: `Vote on: ${input.billTitle}`,
        description: input.billSummary
          ?? `Legislative vote on Bill #${input.billNumber}: ${input.billTitle}`,
        type: 'legislative_vote',
        method: 'yea_nay_abstain',
        requiredPermission: 'legislative_leader',
        config: {
          majorityType: 'simple',
          passThreshold: 0.5,
          anonymousBallots: false,
          sealedResults: false,
        },
        relatedBillId: input.billId,
        createdById: input.createdById,
        status: 'voting_open',
        votingOpensAt: now,
        votingClosesAt: votingCloses,
      })
      .returning({
        id: elections.id,
        title: elections.title,
        description: elections.description,
        votingOpensAt: elections.votingOpensAt,
        votingClosesAt: elections.votingClosesAt,
      });

    if (!election) {
      throw new Error('Failed to create legislative vote.');
    }

    const [updatedBill] = await tx
      .update(bills)
      .set({
        status: BillStatus.VOTING,
        playerVoteId: election.id,
        updatedAt: now,
      })
      .where(and(
        eq(bills.id, input.billId),
        eq(bills.status, previousStatus),
      ))
      .returning({
        id: bills.id,
        status: bills.status,
        playerVoteId: bills.playerVoteId,
      });

    if (!updatedBill || !updatedBill.playerVoteId) {
      throw new Error('Failed to update bill status. It may have changed.');
    }

    await tx.insert(billStatusLog).values({
      billId: input.billId,
      fromStatus: previousStatus,
      toStatus: BillStatus.VOTING,
      changedById: input.createdById,
      notes: `Legislature vote created (election ${election.id})`,
    });

    return {
      election: {
        id: election.id,
        title: election.title,
        description: election.description ?? '',
        votingOpensAt: election.votingOpensAt ?? now,
        votingClosesAt: election.votingClosesAt ?? votingCloses,
      },
      bill: {
        id: updatedBill.id,
        status: updatedBill.status,
        playerVoteId: updatedBill.playerVoteId,
      },
      previousBillStatus: previousStatus,
    };
  });
}
