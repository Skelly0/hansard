import { eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog, elections, players } from '@hansard/db';
import { BillStatus, ElectionStatus, ElectionType } from '@hansard/shared';

export interface ReraiseBillForVoteInput {
  billId: string;
  actorDiscordId: string;
  reason?: string | null;
  now?: Date;
}

export interface ReraiseBillForVoteResult {
  bill: {
    id: string;
    title: string;
    billNumber: number;
    status: string;
    playerVoteId: string | null;
  };
  election: {
    id: string;
    title: string;
    status: string;
  };
  previousBillStatus: string;
  previousElectionStatus: string;
}

const RERAISEABLE_BILL_STATUSES = new Set<string>([
  BillStatus.VOTING,
  BillStatus.PLAYER_PASSED,
  BillStatus.PLAYER_REJECTED,
]);

function buildStatusLogNote(electionId: string, actorDiscordId: string, reason?: string | null): string {
  const base = `Re-raised by <@${actorDiscordId}>; cancelled mistaken legislature vote ${electionId}.`;
  const trimmedReason = reason?.replace(/\s+/g, ' ').trim();
  return trimmedReason ? `${base} Reason: ${trimmedReason}` : base;
}

export async function reraiseBillForVote(
  database: Database,
  input: ReraiseBillForVoteInput,
): Promise<ReraiseBillForVoteResult> {
  const [bill] = await database
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      authorId: bills.authorId,
      status: bills.status,
      playerVoteId: bills.playerVoteId,
      playerVoteResult: bills.playerVoteResult,
      playerVoteAt: bills.playerVoteAt,
    })
    .from(bills)
    .where(eq(bills.id, input.billId))
    .limit(1);

  if (!bill) {
    throw new Error('Bill not found');
  }

  if (!bill.playerVoteId) {
    throw new Error('Bill does not have a linked player vote to re-raise');
  }

  if (!RERAISEABLE_BILL_STATUSES.has(bill.status)) {
    throw new Error(
      `Bill is in '${bill.status}' status; only voting, player_passed, or player_rejected bills can be re-raised`,
    );
  }

  const [election] = await database
    .select({
      id: elections.id,
      title: elections.title,
      type: elections.type,
      status: elections.status,
      relatedBillId: elections.relatedBillId,
    })
    .from(elections)
    .where(eq(elections.id, bill.playerVoteId))
    .limit(1);

  if (!election) {
    throw new Error('Linked player vote was not found');
  }

  if (election.type !== ElectionType.LEGISLATIVE_VOTE) {
    throw new Error('Linked player vote is not a legislative vote');
  }

  if (election.relatedBillId !== bill.id) {
    throw new Error('Linked legislative vote does not point back to this bill');
  }

  if (election.status === ElectionStatus.CERTIFIED) {
    throw new Error('Certified legislative votes cannot be re-raised');
  }

  const [actor] = await database
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, input.actorDiscordId))
    .limit(1);

  if (!actor) {
    throw new Error('You need a registered character to re-raise a bill.');
  }

  const now = input.now ?? new Date();

  return database.transaction(async (tx) => {
    const [updatedElection] = await tx
      .update(elections)
      .set({
        status: ElectionStatus.CANCELLED,
        updatedAt: now,
      })
      .where(eq(elections.id, election.id))
      .returning({
        id: elections.id,
        title: elections.title,
        status: elections.status,
        relatedBillId: elections.relatedBillId,
      });

    if (!updatedElection) {
      throw new Error('Failed to cancel linked legislative vote');
    }

    const [updatedBill] = await tx
      .update(bills)
      .set({
        status: BillStatus.SUBMITTED,
        playerVoteId: null,
        playerVoteResult: null,
        playerVoteAt: null,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id))
      .returning({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
        status: bills.status,
        playerVoteId: bills.playerVoteId,
      });

    if (!updatedBill) {
      throw new Error('Failed to update bill status');
    }

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: bill.status,
      toStatus: BillStatus.SUBMITTED,
      changedById: actor.id,
      notes: buildStatusLogNote(election.id, input.actorDiscordId, input.reason),
    });

    return {
      bill: updatedBill,
      election: {
        id: updatedElection.id,
        title: updatedElection.title,
        status: updatedElection.status,
      },
      previousBillStatus: bill.status,
      previousElectionStatus: election.status,
    };
  });
}
