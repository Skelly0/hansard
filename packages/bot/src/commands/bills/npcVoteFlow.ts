import { and, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog } from '@hansard/db';
import type { NpcVote } from '@hansard/shared';

export interface RecordNpcVoteInput {
  billId: string;
  expectedStatus: string;
  newStatus: string;
  npcVote: NpcVote;
  enteredById: string;
  notes: string;
  now?: Date;
}

export interface RecordNpcVoteResult {
  bill: {
    id: string;
    title: string;
    billNumber: number;
    status: string;
  };
  previousStatus: string;
}

/**
 * Transactionally flip a bill to the NPC-vote result status and append a
 * `bill_status_log` row. The UPDATE includes a status guard so a concurrent
 * status change between the read and the write cannot silently overwrite
 * a drifted bill — instead the transaction throws and rolls back.
 */
export async function recordNpcVote(
  database: Database,
  input: RecordNpcVoteInput,
): Promise<RecordNpcVoteResult> {
  const now = input.now ?? new Date();
  const previousStatus = input.expectedStatus;

  return database.transaction(async (tx) => {
    const [updated] = await tx
      .update(bills)
      .set({
        npcVote: input.npcVote,
        status: input.newStatus,
        updatedAt: now,
      })
      .where(and(
        eq(bills.id, input.billId),
        eq(bills.status, previousStatus),
      ))
      .returning({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
        status: bills.status,
      });

    if (!updated) {
      throw new Error('Bill status changed before NPC vote could be recorded.');
    }

    await tx.insert(billStatusLog).values({
      billId: input.billId,
      fromStatus: previousStatus,
      toStatus: input.newStatus,
      changedById: input.enteredById,
      notes: input.notes,
    });

    return {
      bill: updated,
      previousStatus,
    };
  });
}
