import { and, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog } from '@hansard/db';
import { BillStatus } from '@hansard/shared';

export interface RepealBillInput {
  billId: string;
  expectedStatus: string;
  changedById: string;
  actorDiscordId: string;
  now?: Date;
}

export interface RepealBillResult {
  bill: {
    id: string;
    title: string;
    billNumber: number;
    status: string;
  };
  previousStatus: string;
}

/**
 * Transactionally flip a bill to `repealed` and append a `bill_status_log`
 * row. The UPDATE includes a status guard so a concurrent status change
 * between the read and the write cannot silently overwrite a drifted bill —
 * instead the transaction throws and rolls back.
 */
export async function repealBill(
  database: Database,
  input: RepealBillInput,
): Promise<RepealBillResult> {
  const now = input.now ?? new Date();
  const previousStatus = input.expectedStatus;

  return database.transaction(async (tx) => {
    const [updated] = await tx
      .update(bills)
      .set({
        status: BillStatus.REPEALED,
        repealedAt: now,
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
      throw new Error('Bill status changed before repeal could be recorded.');
    }

    await tx.insert(billStatusLog).values({
      billId: input.billId,
      fromStatus: previousStatus,
      toStatus: BillStatus.REPEALED,
      changedById: input.changedById,
      notes: `Repealed by <@${input.actorDiscordId}>`,
    });

    return {
      bill: updated,
      previousStatus,
    };
  });
}
