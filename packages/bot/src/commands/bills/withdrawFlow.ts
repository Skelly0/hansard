import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { bills, billStatusLog, officeHolders, offices, players } from '@hansard/db';
import { BillStatus } from '@hansard/shared';

interface WithdrawBillOptions {
  billId: string;
  actorDiscordId: string;
  reason?: string | null;
  now?: Date;
}

interface WithdrawnBill {
  id: string;
  title: string;
  billNumber: number;
  status: string;
}

interface WithdrawBillResult {
  bill: WithdrawnBill;
  previousStatus: string;
}

function formatBillNumber(billNumber: number): string {
  return `B-${String(billNumber).padStart(3, '0')}`;
}

function buildWithdrawalNote(actorDiscordId: string, reason?: string | null): string {
  const trimmedReason = reason?.trim();
  return [
    `Withdrawn by <@${actorDiscordId}>`,
    trimmedReason ? `Reason: ${trimmedReason}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' - ');
}

async function hasLegislativeLeaderPermission(db: Database, playerId: string): Promise<boolean> {
  const rows = await db
    .select({ permissions: offices.permissions })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(
      eq(officeHolders.playerId, playerId),
      isNull(officeHolders.endDate),
      eq(offices.isActive, true),
    ));

  return rows.some((row) =>
    Array.isArray(row.permissions) &&
    row.permissions.includes('legislative_leader'),
  );
}

export async function withdrawSubmittedBill(
  db: Database,
  options: WithdrawBillOptions,
): Promise<WithdrawBillResult> {
  const [bill] = await db
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      status: bills.status,
      authorId: bills.authorId,
      submittedById: bills.submittedById,
    })
    .from(bills)
    .where(eq(bills.id, options.billId))
    .limit(1);

  if (!bill) {
    throw new Error('Bill not found.');
  }

  if (bill.status !== BillStatus.SUBMITTED) {
    throw new Error(
      `Bill #${formatBillNumber(bill.billNumber)} is in status \`${bill.status}\`; only submitted bills can be withdrawn.`,
    );
  }

  const [actor] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, options.actorDiscordId))
    .limit(1);

  if (!actor) {
    throw new Error('You need a registered character to withdraw a bill.');
  }

  const isAuthorOrSubmitter = actor.id === bill.authorId || actor.id === bill.submittedById;
  const canManageLegislature = isAuthorOrSubmitter
    ? false
    : await hasLegislativeLeaderPermission(db, actor.id);

  if (!isAuthorOrSubmitter && !canManageLegislature) {
    throw new Error('Only the bill author, original submitter, or Chancellor can withdraw it.');
  }

  const now = options.now ?? new Date();
  const note = buildWithdrawalNote(options.actorDiscordId, options.reason);

  const updatedBill = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bills)
      .set({
        status: BillStatus.WITHDRAWN,
        updatedAt: now,
      })
      .where(and(
        eq(bills.id, bill.id),
        eq(bills.status, BillStatus.SUBMITTED),
      ))
      .returning({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
        status: bills.status,
      });

    if (!updated) {
      throw new Error('Failed to withdraw bill. It may no longer be submitted.');
    }

    await tx.insert(billStatusLog).values({
      billId: bill.id,
      fromStatus: bill.status,
      toStatus: BillStatus.WITHDRAWN,
      changedById: actor.id,
      notes: note,
    });

    return updated;
  });

  return {
    bill: updatedBill,
    previousStatus: bill.status,
  };
}
