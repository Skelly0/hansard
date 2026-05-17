import { and, eq } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog } from '@hansard/db';
import { BillStatus } from '@hansard/shared';

export interface EnactBillInput {
  billId: string;
  expectedStatus: string;
  changedById: string;
  actorDiscordId?: string;
  auditNote?: string;
  now?: Date;
}

export interface EnactBillResult {
  bill: {
    id: string;
    title: string;
    billNumber: number;
    status: string;
    enactedAt: Date | null;
    effectiveAt: Date | null;
  };
  previousStatus: string;
}

/**
 * Transactionally flip a bill to `enacted` and append a `bill_status_log` row.
 * Either both writes commit or neither does, so a failure in the audit log
 * cannot leave the bill silently enacted with no history.
 */
export async function enactBill(
  database: Database,
  input: EnactBillInput,
): Promise<EnactBillResult> {
  const now = input.now ?? new Date();
  const previousStatus = input.expectedStatus;

  return database.transaction(async (tx) => {
    const [updated] = await tx
      .update(bills)
      .set({
        status: BillStatus.ENACTED,
        enactedAt: now,
        effectiveAt: now,
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
        enactedAt: bills.enactedAt,
        effectiveAt: bills.effectiveAt,
      });

    if (!updated) {
      throw new Error('Failed to enact bill. Its status may have changed.');
    }

    await tx.insert(billStatusLog).values({
      billId: input.billId,
      fromStatus: previousStatus,
      toStatus: BillStatus.ENACTED,
      changedById: input.changedById,
      notes: input.auditNote
        ?? (input.actorDiscordId ? `Enacted by <@${input.actorDiscordId}>` : 'Bill enacted'),
    });

    return {
      bill: updated,
      previousStatus,
    };
  });
}
