// Stage 5. Matches Blaaiz payout outcomes to our payments.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { addDays, addMonths } from "../lib/dates";
import { bn, formatMoney } from "../lib/money";
import { audit, merchantReference, nextActionNumber } from "../lib/repo";
import type { ProposedAction } from "./types";

export interface PayoutUpdate {
  transactionId?: string | null;
  merchantReference?: string | null;
  status: "PROCESSING" | "SUCCESSFUL" | "FAILED";
  reason?: string;
}

export async function applyPayoutUpdate(db: PrismaClient, companyId: string, u: PayoutUpdate): Promise<string> {
  const exec = await db.execution.findFirst({
    where: {
      companyId,
      kind: "PAYOUT",
      OR: [
        ...(u.transactionId ? [{ blaaizTransactionId: u.transactionId }] : []),
        ...(u.merchantReference ? [{ idempotencyKey: u.merchantReference }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: { action: true },
  });
  if (!exec) return "No matching payout";
  if (exec.status === "SUCCESSFUL" || exec.status === "FAILED") return `Already ${exec.status.toLowerCase()}`;

  const payment = exec.action.paymentId
    ? await db.scheduledPayment.findUnique({ where: { id: exec.action.paymentId }, include: { payee: true } })
    : null;

  if (u.status === "PROCESSING") {
    await db.execution.update({ where: { id: exec.id }, data: { status: "PROCESSING" } });
    return "Processing";
  }

  if (u.status === "SUCCESSFUL") {
    await db.execution.update({ where: { id: exec.id }, data: { status: "SUCCESSFUL" } });
    if (payment) {
      await db.scheduledPayment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date() } });
      await audit(db, companyId, "BLAAIZ", `Payout to ${payment.payee.name} completed: ${formatMoney(bn(payment.amount), payment.currency)}`, "ScheduledPayment", payment.id);
      if (payment.recurrence !== "NONE") {
        const nextDue = payment.recurrence === "WEEKLY" ? addDays(payment.dueDate, 7) : addMonths(payment.dueDate, 1);
        const id = `pm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        await db.scheduledPayment.create({
          data: {
            id,
            companyId,
            payeeId: payment.payeeId,
            amount: payment.amount,
            amountType: payment.amountType,
            currency: payment.currency,
            dueDate: nextDue,
            recurrence: payment.recurrence,
            priority: payment.priority,
            critical: payment.critical,
            memo: payment.memo,
            merchantReference: merchantReference(id, nextDue),
          },
        });
      }
    }
    return "Paid";
  }

  // FAILED: release the payment and escalate.
  await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED" } });
  await db.action.update({ where: { id: exec.actionId }, data: { status: "FAILED" } });
  if (payment) {
    await db.scheduledPayment.update({ where: { id: payment.id }, data: { status: "PROPOSED" } });
    const prev = JSON.parse(exec.action.payload) as ProposedAction;
    const escalation: ProposedAction = {
      ...prev,
      type: "ESCALATE",
      reasonCode: "PAYOUT_FAILED",
      reasons: ["PAYOUT_FAILED"],
      plan: { kind: "PAY" },
      swap: undefined,
      notes: [u.reason ?? "Blaaiz reported the payout failed"],
    };
    await db.action.create({
      data: {
        companyId,
        number: await nextActionNumber(db, companyId),
        type: "ESCALATE",
        paymentId: payment.id,
        payload: JSON.stringify(escalation),
        reasonCode: "PAYOUT_FAILED",
        explanation: `Payout to ${payment.payee.name} failed${u.reason ? `: ${u.reason}` : ""}. Funds are back in the wallet. Check the account details, then approve to retry.`,
        policyResult: exec.action.policyResult,
        status: "PENDING",
      },
    });
    await audit(db, companyId, "BLAAIZ", `Payout to ${payment.payee.name} failed${u.reason ? `: ${u.reason}` : ""}`, "ScheduledPayment", payment.id);
  }
  return "Failed and escalated";
}

/** Polling fallback for payouts whose webhook never arrived. */
export async function reconcileOpen(db: PrismaClient, client: BlaaizClient, companyId: string): Promise<number> {
  const open = await db.execution.findMany({ where: { companyId, kind: "PAYOUT", status: { in: ["PENDING", "PROCESSING"] }, blaaizTransactionId: { not: null } } });
  let changed = 0;
  for (const e of open) {
    try {
      const tx = await client.getTransaction(e.blaaizTransactionId!);
      if (tx.status === "SUCCESSFUL" || tx.status === "FAILED") {
        await applyPayoutUpdate(db, companyId, { transactionId: tx.id, status: tx.status });
        changed++;
      }
    } catch {
      // Leave it for the next cycle.
    }
  }
  return changed;
}
