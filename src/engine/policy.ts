// Pure. Every action passes through evaluate() before the executor runs it.
// "needs_owner" checks can be cleared by an owner approval; "fail" checks cannot.
import { type Currency, formatMoney, toNgn } from "../lib/money";
import { pairAllowed, rateDeviationPct } from "./decide";
import type { MarketInfo, PayeeInfo, PolicyConfig, ProposedAction, ReasonCode, WalletState } from "./types";

export type CheckStatus = "pass" | "needs_owner" | "approved" | "fail";

export interface PolicyCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  reason?: ReasonCode;
}

export interface PolicyResult {
  checks: PolicyCheck[];
  autoOk: boolean; // every check passed: may run without the owner
  ownerOk: boolean; // nothing hard-failed: may run once the owner approves
}

export interface PolicyContext {
  policy: PolicyConfig;
  paused: boolean;
  wallets: WalletState[];
  market: MarketInfo;
  todaySpentNgn: number;
  payee?: PayeeInfo;
  ownerApproved?: boolean;
}

type Evaluable = Pick<ProposedAction, "type" | "amount" | "currency" | "fee" | "swap" | "plan">;

export function evaluate(action: Evaluable, ctx: PolicyContext): PolicyResult {
  const { policy, market } = ctx;
  const checks: PolicyCheck[] = [];
  const add = (c: PolicyCheck) => checks.push(c);
  const bal = (c: Currency) => ctx.wallets.find((w) => w.currency === c)?.balance ?? 0;
  const buf = (c: Currency) => policy.buffer[c] ?? 0;
  const cap = (c: Currency) => policy.perPaymentCap[c] ?? 0;
  const ngn = (m: number, c: Currency) => toNgn(m, c, market.rates);

  const kind = action.type === "ESCALATE" ? action.plan?.kind ?? "PAY" : action.type;
  const swap = action.type === "ESCALATE" ? action.plan?.swap : action.swap;
  const hasSwap = (kind === "SWAP" || kind === "SWAP_THEN_PAY") && !!swap;
  const hasPay = kind === "PAY" || kind === "SWAP_THEN_PAY";

  add(
    ctx.paused
      ? { id: "paused", label: "Bursar is running", status: "fail", detail: "Paused by the owner, so nothing executes", reason: "PAUSED" }
      : { id: "paused", label: "Bursar is running", status: "pass", detail: "Not paused" },
  );

  if (hasSwap && swap) {
    // Rebalancing only ever moves money between this company's own wallets.
    const own = ctx.wallets.some((w) => w.currency === swap.from) && ctx.wallets.some((w) => w.currency === swap.to);
    add({
      id: "own_wallets",
      label: "Between your own wallets",
      status: own ? "pass" : "fail",
      detail: own ? `${swap.from} and ${swap.to} wallets both belong to this business` : `This business has no ${ctx.wallets.some((w) => w.currency === swap.from) ? swap.to : swap.from} wallet`,
    });
    const pairOk = pairAllowed(policy, swap.from, swap.to);
    add({
      id: "pair",
      label: `Pair ${swap.from} to ${swap.to} allowed`,
      status: pairOk ? "pass" : "fail",
      detail: pairOk ? "Listed in allowed pairs" : "Not in allowed pairs",
      reason: pairOk ? undefined : "PAIR_NOT_ALLOWED",
    });
    const dev = rateDeviationPct(swap.from, swap.to, market);
    add({
      id: "rate",
      label: "Rate within band",
      status: dev <= policy.maxRateDeviationPct ? "pass" : "needs_owner",
      detail: `${dev <= 0 ? "Better than" : `${dev.toFixed(2)}% worse than`} the 7-day average (max ${policy.maxRateDeviationPct}%)`,
      reason: dev <= policy.maxRateDeviationPct ? undefined : "RATE_TOO_WIDE",
    });
    const swapNgn = ngn(swap.fromAmount, swap.from);
    add({
      id: "swap_cap",
      label: "Under swap cap",
      status: swapNgn <= policy.perSwapCapNgn ? "pass" : "needs_owner",
      detail: `${formatMoney(swapNgn, "NGN", { decimals: false })} of ${formatMoney(policy.perSwapCapNgn, "NGN", { decimals: false })}`,
      reason: swapNgn <= policy.perSwapCapNgn ? undefined : "OVER_SWAP_CAP",
    });
    const srcAfter = bal(swap.from) - swap.fromAmount;
    add(
      srcAfter < 0
        ? { id: "swap_funds", label: `${swap.from} wallet covers the swap`, status: "fail", detail: `Short by ${formatMoney(-srcAfter, swap.from)}` }
        : {
            id: "swap_buffer",
            label: `${swap.from} buffer kept`,
            status: srcAfter >= buf(swap.from) ? "pass" : "needs_owner",
            detail: `Ends at ${formatMoney(srcAfter, swap.from)}, buffer ${formatMoney(buf(swap.from), swap.from)}`,
          },
    );
  }

  if (hasPay) {
    const cur = action.currency;
    const total = action.amount + action.fee;
    if (ctx.payee) {
      add({
        id: "allowlist",
        label: "Payee allowlisted",
        status: ctx.payee.allowlisted ? "pass" : "needs_owner",
        detail: ctx.payee.allowlisted ? `${ctx.payee.name} is approved` : `${ctx.payee.name} has never been paid`,
        reason: ctx.payee.allowlisted ? undefined : "NEW_PAYEE",
      });
    }
    const capOk = action.amount <= cap(cur);
    add({
      id: "payment_cap",
      label: "Under per-payment cap",
      status: capOk ? "pass" : "needs_owner",
      detail: `${formatMoney(action.amount, cur)} of ${formatMoney(cap(cur), cur)}`,
      reason: capOk ? undefined : "OVER_PAYMENT_CAP",
    });
    const dayAfter = ctx.todaySpentNgn + ngn(total, cur);
    const dayOk = dayAfter <= policy.dailyCapNgn;
    add({
      id: "daily_cap",
      label: "Under daily cap",
      status: dayOk ? "pass" : "needs_owner",
      detail: `${formatMoney(dayAfter, "NGN", { decimals: false })} of ${formatMoney(policy.dailyCapNgn, "NGN", { decimals: false })} today`,
      reason: dayOk ? undefined : "OVER_DAILY_CAP",
    });
    const after = bal(cur) + (hasSwap && swap ? swap.toAmount : 0) - total;
    add(
      after < 0
        ? { id: "funds", label: `${cur} wallet covers the payment`, status: "fail", detail: `Short by ${formatMoney(-after, cur)} including fees` }
        : {
            id: "buffer",
            label: `${cur} buffer kept`,
            status: after >= buf(cur) ? "pass" : "needs_owner",
            detail: `Ends at ${formatMoney(after, cur)}, buffer ${formatMoney(buf(cur), cur)}`,
          },
    );
  }

  add({
    id: "auto",
    label: "Auto-execute on",
    status: policy.autoExecute ? "pass" : "needs_owner",
    detail: policy.autoExecute ? "Routine actions may run alone" : "Every action waits for you",
  });

  if (ctx.ownerApproved) for (const c of checks) if (c.status === "needs_owner") c.status = "approved";

  return {
    checks,
    autoOk: checks.every((c) => c.status === "pass"),
    ownerOk: checks.every((c) => c.status !== "fail"),
  };
}
