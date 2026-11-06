// The only place that calls swap() or payout(). Re-checks policy against live
// balances first, so nothing can move money without passing evaluate().
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { env } from "../lib/env";
import { formatMoney } from "../lib/money";
import { audit, getCompany, loadPolicy, toPayeeInfo } from "../lib/repo";
import { loadMarket, syncWallets, todaySpentNgn } from "./observe";
import { evaluate, type PolicyResult } from "./policy";
import type { ProposedAction } from "./types";

export interface ExecuteOutcome {
  status: "EXECUTED" | "BLOCKED" | "FAILED" | "SKIPPED";
  message: string;
  policy?: PolicyResult;
}

export async function executeAction(
  db: PrismaClient,
  client: BlaaizClient,
  actionId: string,
  opts: { ownerApproved: boolean },
): Promise<ExecuteOutcome> {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  const proposed = JSON.parse(action.payload) as ProposedAction;
  const kind = proposed.type === "ESCALATE" ? proposed.plan?.kind ?? "PAY" : proposed.type;
  const swap = proposed.type === "ESCALATE" ? proposed.plan?.swap : proposed.swap;
  if (kind !== "PAY" && kind !== "SWAP" && kind !== "SWAP_THEN_PAY") {
    return { status: "SKIPPED", message: `${proposed.type} moves no money` };
  }

  const payment = action.paymentId
    ? await db.scheduledPayment.findUniqueOrThrow({ where: { id: action.paymentId }, include: { payee: true } })
    : null;

  // Idempotency: one payout per payment occurrence.
  if (payment) {
    const prior = await db.execution.findFirst({
      where: { kind: "PAYOUT", idempotencyKey: payment.merchantReference, status: { not: "FAILED" } },
    });
    if (prior || payment.status === "PAID" || payment.status === "EXECUTING") {
      await db.action.update({ where: { id: action.id }, data: { status: "SKIPPED", explanation: `${action.explanation} Skipped: this occurrence was already paid.` } });
      return { status: "SKIPPED", message: "Already paid for this occurrence" };
    }
  }

  // Live re-check.
  const [company, policy] = await Promise.all([getCompany(db), loadPolicy(db)]);
  const wallets = await syncWallets(db, client);
  const market = await loadMarket(db, client, false);
  const spent = await todaySpentNgn(db, market.usdNgn);
  const live: ProposedAction = { ...proposed, type: kind, swap };
  const result = evaluate(live, {
    policy,
    paused: company.paused,
    wallets,
    market,
    todaySpentNgn: spent,
    payee: payment ? toPayeeInfo(payment.payee) : undefined,
    ownerApproved: opts.ownerApproved,
  });
  const allowed = opts.ownerApproved ? result.ownerOk : result.autoOk;
  await db.action.update({ where: { id: action.id }, data: { policyResult: JSON.stringify(result) } });
  if (!allowed) {
    const failed = result.checks.filter((c) => c.status === "fail" || (!opts.ownerApproved && c.status === "needs_owner"));
    return { status: "BLOCKED", message: failed.map((c) => `${c.label}: ${c.detail}`).join("; "), policy: result };
  }

  const walletId = (c: string) => wallets.find((w) => w.currency === c)?.blaaizWalletId;

  try {
    if (swap) {
      const key = `swap-${action.id}`;
      const done = await db.execution.findFirst({ where: { kind: "SWAP", idempotencyKey: key, status: "SUCCESSFUL" } });
      if (!done) {
        const req = { fromWalletId: walletId(swap.from)!, toWalletId: walletId(swap.to)!, amount: swap.toAmount, amountType: "to" as const };
        const exec = await db.execution.create({
          data: { actionId: action.id, kind: "SWAP", idempotencyKey: key, request: JSON.stringify(req), status: "PENDING" },
        });
        try {
          const res = await client.swap(req);
          await db.execution.update({
            where: { id: exec.id },
            data: { response: JSON.stringify(res), blaaizTransactionId: res.transactionId, status: res.status === "FAILED" ? "FAILED" : "SUCCESSFUL" },
          });
          await audit(db, "BURSAR", `Swapped ${formatMoney(res.fromAmount, swap.from)} to ${formatMoney(res.toAmount, swap.to)} at ${res.rate ?? swap.rate}`, "Action", action.id);
        } catch (e) {
          await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", response: JSON.stringify({ error: String(e) }) } });
          throw e;
        }
      }
    }

    if (kind !== "SWAP" && payment) {
      const fee = proposed.fee;
      const req = {
        walletId: walletId(payment.currency)!,
        customerId: company.blaaizCustomerId ?? env.customerId,
        method: payment.payee.method as "bank_transfer" | "mobile_money",
        fromCurrency: proposed.currency,
        toCurrency: proposed.currency,
        toAmount: proposed.amount,
        bankId: payment.payee.bankId,
        accountNumber: payment.payee.accountNumber,
        accountName: payment.payee.accountName,
        phoneNumber: payment.payee.phone,
        operatorId: payment.payee.operatorId,
        merchantReference: payment.merchantReference,
      };
      const exec = await db.execution.create({
        data: {
          actionId: action.id,
          kind: "PAYOUT",
          idempotencyKey: payment.merchantReference,
          request: JSON.stringify({ ...req, _fee: fee }),
          status: "PENDING",
        },
      });
      try {
        const res = await client.payout(req);
        await db.execution.update({
          where: { id: exec.id },
          data: { response: JSON.stringify(res), blaaizTransactionId: res.transactionId, status: "PROCESSING" },
        });
        await db.scheduledPayment.update({
          where: { id: payment.id },
          data: { status: "EXECUTING", blaaizTransactionId: res.transactionId },
        });
        await audit(db, "BURSAR", `Sent payout ${formatMoney(proposed.amount, proposed.currency)} to ${payment.payee.name}`, "Action", action.id);
      } catch (e) {
        await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", response: JSON.stringify({ error: String(e) }) } });
        throw e;
      }
    }

    await db.action.update({ where: { id: action.id }, data: { status: "EXECUTED" } });
    // Recorded when Blaaiz confirms; this is the live balance after debits.
    await syncWallets(db, client);
    return { status: "EXECUTED", message: "Done", policy: result };
  } catch (e) {
    await db.action.update({ where: { id: action.id }, data: { status: "FAILED", explanation: `${action.explanation} Failed: ${String(e).slice(0, 200)}` } });
    if (payment) await db.scheduledPayment.update({ where: { id: payment.id }, data: { status: "SCHEDULED" } });
    await audit(db, "BURSAR", `Execution failed: ${String(e).slice(0, 200)}`, "Action", action.id);
    return { status: "FAILED", message: String(e) };
  }
}
