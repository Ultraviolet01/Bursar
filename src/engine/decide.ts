// Pure. Walks due payments in priority order and produces actions.
// No I/O: quotes, rates and balances arrive as input.
import { daysBetween } from "../lib/dates";
import { CURRENCIES, type Currency, swapCostFor, toNgn } from "../lib/money";
import { forecast, type Outflow } from "./forecast";
import type {
  MarketInfo,
  PaymentInfo,
  PayoutQuote,
  PolicyConfig,
  ProposedAction,
  ReasonCode,
  SwapPlan,
  WalletState,
} from "./types";

export interface DecideInput {
  today: string;
  wallets: WalletState[];
  policy: PolicyConfig;
  market: MarketInfo;
  /** Payments not yet paid, executing or waiting on the owner. */
  payments: PaymentInfo[];
  quotes: Record<string, PayoutQuote>;
  /** NGN-equivalent already paid out today. */
  todaySpentNgn: number;
  /** Top-up swaps already waiting on the owner, so we don't propose twice. */
  pendingTopUps?: Currency[];
}

export interface DecideResult {
  actions: ProposedAction[];
  balancesAfter: Record<Currency, number>;
}

export function rateDeviationPct(from: Currency, to: Currency, market: MarketInfo): number {
  // Buying USD with NGN: worse when NGN per USD is higher than average.
  const { usdNgn, usdNgnAvg7d } = market;
  if (from === "NGN" && to === "USD") return ((usdNgn - usdNgnAvg7d) / usdNgnAvg7d) * 100;
  return ((usdNgnAvg7d - usdNgn) / usdNgnAvg7d) * 100;
}

export function pairAllowed(policy: PolicyConfig, from: Currency, to: Currency): boolean {
  return policy.allowedPairs.includes(`${from}>${to}`);
}

function sortPayments(a: PaymentInfo, b: PaymentInfo) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

export function decide(input: DecideInput): DecideResult {
  const { policy, market, today } = input;
  const balance = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>;
  for (const w of input.wallets) balance[w.currency] = w.balance;
  const reserved = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>;
  const available = (c: Currency) => balance[c] - policy.buffer[c] - reserved[c];
  let spentNgn = input.todaySpentNgn;

  const actions: ProposedAction[] = [];
  const due = input.payments
    .filter((p) => (p.status === "SCHEDULED" || p.status === "DEFERRED") && p.dueDate <= today)
    .sort(sortPayments);

  /** Find a surplus wallet that can fund `shortfall` into `target`. */
  function findSwap(target: Currency, shortfall: number): { plan?: SwapPlan; blocked?: ReasonCode } {
    let blocked: ReasonCode | undefined;
    for (const source of CURRENCIES) {
      if (source === target) continue;
      if (!pairAllowed(policy, source, target)) {
        blocked ??= "PAIR_NOT_ALLOWED";
        continue;
      }
      const cost = swapCostFor(shortfall, source, target, market.usdNgn, market.swapFeeBps);
      if (available(source) < cost) continue;
      if (rateDeviationPct(source, target, market) > policy.maxRateDeviationPct) {
        blocked = "RATE_TOO_WIDE";
        continue;
      }
      if (toNgn(cost, source, market.usdNgn) > policy.perSwapCapNgn) {
        blocked = "OVER_SWAP_CAP";
        continue;
      }
      return { plan: { from: source, to: target, amountType: "to", toAmount: shortfall, fromAmount: cost, rate: market.usdNgn } };
    }
    return { blocked };
  }

  for (const p of due) {
    const cur = p.currency;
    const quote = input.quotes[p.id] ?? { fee: 0, total: p.amount };
    const base = { paymentId: p.id, amount: p.amount, currency: cur, fee: quote.fee, notes: [] as string[] };

    // Owner-gated checks first.
    const escalations: ReasonCode[] = [];
    if (!p.payee.allowlisted) escalations.push("NEW_PAYEE");
    // Cap applies to what the payee receives; fees are shown separately.
    if (p.amount > policy.perPaymentCap[cur]) escalations.push("OVER_PAYMENT_CAP");
    if (spentNgn + toNgn(quote.total, cur, market.usdNgn) > policy.dailyCapNgn) escalations.push("OVER_DAILY_CAP");

    if (escalations.length) {
      // Work out what approval would do, ignoring the owner-gated limits.
      const avail = available(cur);
      const plan: ProposedAction["plan"] =
        avail >= quote.total
          ? { kind: "PAY" }
          : (() => {
              const s = findSwap(cur, quote.total - Math.max(0, avail));
              return s.plan ? { kind: "SWAP_THEN_PAY" as const, swap: s.plan } : { kind: "PAY" as const };
            })();
      actions.push({ ...base, type: "ESCALATE", reasonCode: escalations[0], reasons: escalations, plan });
      continue;
    }

    if (available(cur) >= quote.total) {
      actions.push({ ...base, type: "PAY", reasonCode: "ROUTINE_OK", reasons: ["ROUTINE_OK"] });
      reserved[cur] += quote.total;
      spentNgn += toNgn(quote.total, cur, market.usdNgn);
      continue;
    }

    const shortfall = quote.total - Math.max(0, available(cur));
    const found = findSwap(cur, shortfall);
    if (found.plan) {
      const s = found.plan;
      actions.push({ ...base, type: "SWAP_THEN_PAY", reasonCode: "ROUTINE_OK", reasons: ["ROUTINE_OK"], swap: s });
      balance[s.from] -= s.fromAmount;
      balance[cur] += s.toAmount;
      reserved[cur] += quote.total;
      spentNgn += toNgn(quote.total, cur, market.usdNgn);
      continue;
    }

    const shortReason: ReasonCode = found.blocked ?? (p.critical ? "SHORTFALL_CRITICAL" : "SHORTFALL_NON_CRITICAL");
    const overdueDays = daysBetween(p.dueDate, today);
    if (p.critical) {
      actions.push({ ...base, type: "ESCALATE", reasonCode: shortReason === "SHORTFALL_NON_CRITICAL" ? "SHORTFALL_CRITICAL" : shortReason, reasons: [shortReason] });
    } else if (overdueDays >= policy.maxDeferDays) {
      actions.push({ ...base, type: "ESCALATE", reasonCode: "MAX_DEFER_REACHED", reasons: ["MAX_DEFER_REACHED", shortReason] });
    } else {
      actions.push({ ...base, type: "DEFER", reasonCode: shortReason, reasons: [shortReason] });
    }
  }

  // Opportunistic top-ups for forecasted shortfalls inside the horizon.
  const decidedIds = new Set(actions.filter((a) => a.type === "PAY" || a.type === "SWAP_THEN_PAY").map((a) => a.paymentId));
  const outflows: Outflow[] = input.payments
    .filter((p) => !decidedIds.has(p.id) && (p.status === "SCHEDULED" || p.status === "DEFERRED") && p.dueDate > today)
    .map((p) => ({ currency: p.currency, amount: input.quotes[p.id]?.total ?? p.amount, dueDate: p.dueDate }));
  const fc = forecast({
    today,
    horizonDays: policy.horizonDays,
    wallets: CURRENCIES.map((c) => ({ currency: c, blaaizWalletId: "", balance: balance[c] })),
    policy,
    outflows,
    reserved,
  });
  for (const cur of CURRENCIES) {
    const f = fc[cur];
    if (!f.belowBufferOn || input.pendingTopUps?.includes(cur)) continue;
    const need = f.buffer - f.projected;
    if (need <= 0) continue;
    const found = findSwap(cur, need);
    const swap: SwapPlan =
      found.plan ??
      (() => {
        const from: Currency = cur === "NGN" ? "USD" : "NGN";
        return { from, to: cur, amountType: "to", toAmount: need, fromAmount: swapCostFor(need, from, cur, market.usdNgn, market.swapFeeBps), rate: market.usdNgn };
      })();
    actions.push({
      type: "SWAP",
      reasonCode: "BELOW_BUFFER_FORECAST",
      reasons: found.blocked ? ["BELOW_BUFFER_FORECAST", found.blocked] : ["BELOW_BUFFER_FORECAST"],
      amount: need,
      currency: cur,
      fee: 0,
      swap,
      notes: [`${cur} falls below its buffer on ${f.belowBufferOn}`],
    });
  }

  return { actions, balancesAfter: balance };
}
