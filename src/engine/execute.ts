// The only place that calls swap() or payout(). For every action it:
//   1. previews the fee and rate with Blaaiz,
//   2. re-checks policy with live balances and the previewed numbers,
//   3. executes, then writes ledger entries for every movement.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { env } from "../lib/env";
import { type Currency, formatMoney } from "../lib/money";
import { audit, getCompany, loadPolicy, toPayeeInfo } from "../lib/repo";
import { loadMarket, syncWallets, todaySpentNgn } from "./observe";
import { evaluate, type PolicyResult } from "./policy";
import type { ProposedAction, SwapPlan } from "./types";

export interface ExecuteOutcome {
  status: "EXECUTED" | "BLOCKED" | "FAILED" | "SKIPPED";
  message: string;
  policy?: PolicyResult;
}

type Entry = { currency: Currency; kind: string; amount: number; memo: string; paymentId?: string | null; blaaizTransactionId?: string | null };

export async function writeLedger(db: PrismaClient, companyId: string, actionId: string | null, entries: Entry[]) {
  if (!entries.length) return;
  await db.ledgerEntry.createMany({
    data: entries.map((e) => ({ companyId, actionId, currency: e.currency, kind: e.kind, amount: BigInt(e.amount), memo: e.memo, paymentId: e.paymentId ?? null, blaaizTransactionId: e.blaaizTransactionId ?? null })),
  });
}

export async function executeAction(db: PrismaClient, client: BlaaizClient, actionId: string, opts: { ownerApproved: boolean }): Promise<ExecuteOutcome> {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  const companyId = action.companyId;
  const proposed = JSON.parse(action.payload) as ProposedAction;
  const kind = proposed.type === "ESCALATE" ? proposed.plan?.kind ?? "PAY" : proposed.type;
  let swap: SwapPlan | undefined = proposed.type === "ESCALATE" ? proposed.plan?.swap : proposed.swap;
  if (kind !== "PAY" && kind !== "SWAP" && kind !== "SWAP_THEN_PAY") {
    return { status: "SKIPPED", message: `${proposed.type} moves no money` };
  }

  const payment = action.paymentId ? await db.scheduledPayment.findUniqueOrThrow({ where: { id: action.paymentId }, include: { payee: true } }) : null;

  // Idempotency: one payout per payment occurrence.
  if (payment) {
    const prior = await db.execution.findFirst({ where: { companyId, kind: "PAYOUT", idempotencyKey: payment.merchantReference, status: { not: "FAILED" } } });
    if (prior || payment.status === "PAID" || payment.status === "EXECUTING") {
      await db.action.update({ where: { id: action.id }, data: { status: "SKIPPED", explanation: `${action.explanation} Skipped: this occurrence was already paid.` } });
      return { status: "SKIPPED", message: "Already paid for this occurrence" };
    }
  }

  // 1. Preview fees and rate with Blaaiz before anything moves.
  let payoutFee = proposed.fee;
  if (swap) {
    const q = await client.getFees({ kind: "swap", fromCurrency: swap.from, toCurrency: swap.to, toAmount: swap.toAmount });
    swap = { ...swap, fromAmount: q.total, rate: q.rate ?? swap.rate };
  }
  if (kind !== "SWAP" && payment) {
    const q = await client.getFees({ kind: "payout", fromCurrency: proposed.currency, toCurrency: proposed.currency, toAmount: proposed.amount });
    payoutFee = q.fee;
  }

  // 2. Live re-check with the previewed numbers.
  const [company, policy] = await Promise.all([getCompany(db, companyId), loadPolicy(db, companyId)]);
  const wallets = await syncWallets(db, client, companyId);
  const market = await loadMarket(db, client, false);
  const spent = await todaySpentNgn(db, companyId, market.rates);
  const live: ProposedAction = { ...proposed, type: kind, swap, fee: payoutFee };
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

  // 3. Execute.
  try {
    if (swap) {
      const key = `swap-${action.id}`;
      const done = await db.execution.findFirst({ where: { companyId, kind: "SWAP", idempotencyKey: key, status: "SUCCESSFUL" } });
      if (!done) {
        const req = { fromWalletId: walletId(swap.from)!, toWalletId: walletId(swap.to)!, amount: swap.toAmount, amountType: "to" as const };
        const exec = await db.execution.create({
          data: { companyId, actionId: action.id, kind: "SWAP", idempotencyKey: key, request: JSON.stringify({ ...req, _preview: { fromAmount: swap.fromAmount, rate: swap.rate } }), status: "PENDING" },
        });
        try {
          const res = await client.swap(req);
          await db.execution.update({
            where: { id: exec.id },
            data: { response: JSON.stringify(res), blaaizTransactionId: res.transactionId, status: res.status === "FAILED" ? "FAILED" : "SUCCESSFUL" },
          });
          const memo = `Swap ${swap.from} to ${swap.to} at ${res.rate ?? swap.rate}`;
          await writeLedger(db, companyId, action.id, [
            { currency: swap.from, kind: "SWAP_OUT", amount: -res.fromAmount, memo, blaaizTransactionId: res.transactionId },
            { currency: swap.to, kind: "SWAP_IN", amount: res.toAmount, memo, blaaizTransactionId: res.transactionId },
          ]);
          await audit(db, companyId, "BURSAR", `Swapped ${formatMoney(res.fromAmount, swap.from)} to ${formatMoney(res.toAmount, swap.to)} (previewed ${formatMoney(swap.fromAmount, swap.from)})`, "Action", action.id);
        } catch (e) {
          await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", response: JSON.stringify({ error: String(e) }) } });
          throw e;
        }
      }
    }

    if (kind !== "SWAP" && payment) {
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
        data: { companyId, actionId: action.id, kind: "PAYOUT", idempotencyKey: payment.merchantReference, request: JSON.stringify({ ...req, _fee: payoutFee }), status: "PENDING" },
      });
      try {
        const res = await client.payout(req);
        await db.execution.update({ where: { id: exec.id }, data: { response: JSON.stringify(res), blaaizTransactionId: res.transactionId, status: "PROCESSING" } });
        await db.scheduledPayment.update({ where: { id: payment.id }, data: { status: "EXECUTING", blaaizTransactionId: res.transactionId } });
        await writeLedger(db, companyId, action.id, [
          { currency: proposed.currency, kind: "PAYOUT", amount: -proposed.amount, memo: `Payout to ${payment.payee.name}`, paymentId: payment.id, blaaizTransactionId: res.transactionId },
          ...(payoutFee ? [{ currency: proposed.currency, kind: "FEE", amount: -payoutFee, memo: `Blaaiz payout fee, ${payment.payee.name}`, paymentId: payment.id, blaaizTransactionId: res.transactionId }] : []),
        ]);
        await audit(db, companyId, "BURSAR", `Sent payout ${formatMoney(proposed.amount, proposed.currency)} to ${payment.payee.name} (fee ${formatMoney(payoutFee, proposed.currency)})`, "Action", action.id);
      } catch (e) {
        await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", response: JSON.stringify({ error: String(e) }) } });
        throw e;
      }
    }

    await db.action.update({ where: { id: action.id }, data: { status: "EXECUTED" } });
    await syncWallets(db, client, companyId);
    return { status: "EXECUTED", message: "Done", policy: result };
  } catch (e) {
    await db.action.update({ where: { id: action.id }, data: { status: "FAILED", explanation: `${action.explanation} Failed: ${String(e).slice(0, 200)}` } });
    if (payment) await db.scheduledPayment.update({ where: { id: payment.id }, data: { status: "SCHEDULED" } });
    await audit(db, companyId, "BURSAR", `Execution failed: ${String(e).slice(0, 200)}`, "Action", action.id);
    return { status: "FAILED", message: String(e) };
  }
}
