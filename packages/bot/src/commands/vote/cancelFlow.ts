import { and, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog, elections, players } from '@hansard/db';
import { BillStatus, ElectionStatus, ElectionType } from '@hansard/shared';

export interface CancelVoteInput {
  actorDiscordId: string;
  reason?: string | null;
  now?: Date;
}

export interface CancelVoteResult {
  election: {
    id: string;
    title: string;
    status: string;
  };
  bill: {
    id: string;
    title: string;
    billNumber: number;
    status: string;
    playerVoteId: string | null;
  } | null;
  previousElectionStatus: string;
}

const BILL_STATUSES_RESETTABLE_BY_CANCEL = new Set<string>([
  BillStatus.VOTING,
  BillStatus.PLAYER_PASSED,
  BillStatus.PLAYER_REJECTED,
]);

function buildStatusLogNote(
  electionId: string,
  actorDiscordId: string,
  reason?: string | null,
): string {
  const base = `Cancelled by <@${actorDiscordId}>; cancelled legislative vote ${electionId}.`;
  const trimmedReason = reason?.replace(/\s+/g, ' ').trim();
  return trimmedReason ? `${base} Reason: ${trimmedReason}` : base;
}

function assertVoteCanBeCancelled(election: Pick<typeof elections.$inferSelect, 'status'>): void {
  if (election.status === ElectionStatus.CANCELLED) {
    throw new Error('This vote has already been cancelled');
  }

  if (election.status === ElectionStatus.CERTIFIED) {
    throw new Error('Certified votes cannot be cancelled');
  }
}

function isLinkedLegislativeVote(
  election: Pick<typeof elections.$inferSelect, 'type' | 'relatedBillId'>,
): election is Pick<typeof elections.$inferSelect, 'type' | 'relatedBillId'> & { relatedBillId: string } {
  return election.type === ElectionType.LEGISLATIVE_VOTE && Boolean(election.relatedBillId);
}

export async function cancelVote(
  database: Database,
  election: typeof elections.$inferSelect,
  input: CancelVoteInput,
): Promise<CancelVoteResult> {
  assertVoteCanBeCancelled(election);

  const now = input.now ?? new Date();

  if (!isLinkedLegislativeVote(election)) {
    const [updatedElection] = await database
      .update(elections)
      .set({ status: ElectionStatus.CANCELLED, updatedAt: now })
      .where(and(
        eq(elections.id, election.id),
        eq(elections.status, election.status),
      ))
      .returning({
        id: elections.id,
        title: elections.title,
        status: elections.status,
      });

    if (!updatedElection) {
      throw new Error('Failed to cancel vote');
    }

    return {
      election: updatedElection,
      bill: null,
      previousElectionStatus: election.status,
    };
  }

  const [bill] = await database
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      status: bills.status,
      playerVoteId: bills.playerVoteId,
      playerVoteResult: bills.playerVoteResult,
      playerVoteAt: bills.playerVoteAt,
    })
    .from(bills)
    .where(eq(bills.id, election.relatedBillId))
    .limit(1);

  if (!bill) {
    throw new Error('Linked bill not found');
  }

  if (bill.playerVoteId !== election.id) {
    throw new Error('Linked bill is not using this vote as its active player vote');
  }

  if (!BILL_STATUSES_RESETTABLE_BY_CANCEL.has(bill.status)) {
    throw new Error(
      `Linked bill is in '${bill.status}' status; only voting, player_passed, or player_rejected bills can have their vote cancelled`,
    );
  }

  const [actor] = await database
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, input.actorDiscordId))
    .limit(1);

  if (!actor) {
    throw new Error('You need a registered character to cancel a linked legislative vote.');
  }

  return database.transaction(async (tx) => {
    const [updatedElection] = await tx
      .update(elections)
      .set({
        status: ElectionStatus.CANCELLED,
        updatedAt: now,
      })
      .where(and(
        eq(elections.id, election.id),
        eq(elections.status, election.status),
      ))
      .returning({
        id: elections.id,
        title: elections.title,
        status: elections.status,
      });

    if (!updatedElection) {
      throw new Error('Failed to cancel vote');
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
      .where(and(
        eq(bills.id, bill.id),
        eq(bills.status, bill.status),
        eq(bills.playerVoteId, election.id),
      ))
      .returning({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
        status: bills.status,
        playerVoteId: bills.playerVoteId,
      });

    if (!updatedBill) {
      throw new Error('Failed to update linked bill status');
    }

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: bill.status,
      toStatus: BillStatus.SUBMITTED,
      changedById: actor.id,
      notes: buildStatusLogNote(election.id, input.actorDiscordId, input.reason),
    });

    return {
      election: updatedElection,
      bill: updatedBill,
      previousElectionStatus: election.status,
    };
  });
}
