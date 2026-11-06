// Pure. Walks due payments in priority order and produces actions. No I/O:
// quotes, rates and balances arrive as input.
//
// Priority order (the treasury lifecycle):
//   1. Pay due bills from the currency already held (payroll first).
//   2. Rebalance: one swap per short currency from the wallet with most surplus above its buffer.
//   3. Pay the bills that swap funded.
//   4. Defer non-critical bills that still cannot be covered (cash tight or rate poor).
//   5. Escalate anything outside the rules (new payee, caps, critical shortfall).
//   Then: opportunistic top-ups for wallets forecast to dip below their buffer.
import { daysBetween } from "../lib/dates";
import { type Currency, crossRate, swapCostFor, toNgn } from "../lib/money";
import { forecast, type Outflow } from "./forecast";
import type { MarketInfo, PaymentInfo, PayoutQuote, PolicyConfig, ProposedAction, ReasonCode, SwapPlan, WalletState } from "./types";

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
  /** Currencies with a swap already waiting on the owner (don't propose another). */
  pendingSwaps?: Currency[];
  /** Currencies whose rebalance the owner rejected today (don't ask again today). */
  rejectedSwapsToday?: Currency[];
}

export interface DecideResult {
  actions: ProposedAction[];
  balancesAfter: Partial<Record<Currency, number>>;
}

/** How much worse than its 7-day average the source-to-target rate is, in percent. */
export function rateDeviationPct(from: Currency, to: Currency, market: MarketInfo): number {
  const now = crossRate(from, to, market.rates);
  const avg = crossRate(from, to, market.avg7d);
  return ((now - avg) / avg) * 100;
}

export function pairAllowed(policy: PolicyConfig, from: Currency, to: Currency): boolean {
  return policy.allowedPairs.includes(`${from}>${to}`);
}

function byPriority(a: PaymentInfo, b: PaymentInfo) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

export function decide(input: DecideInput): DecideResult {
  const { policy, market, today } = input;
  const held = input.wallets.map((w) => w.currency);
  const balance = Object.fromEntries(input.wallets.map((w) => [w.currency, w.balance])) as Record<Currency, number>;
  const reserved = Object.fromEntries(held.map((c) => [c, 0])) as Record<Currency, number>;
  const buffer = (c: Currency) => policy.buffer[c] ?? 0;
  const available = (c: Currency) => (balance[c] ?? 0) - buffer(c) - (reserved[c] ?? 0);
  const ngn = (amount: number, c: Currency) => toNgn(amount, c, market.rates);
  const pending = new Set(input.pendingSwaps ?? []);
  const rejected = new Set(input.rejectedSwapsToday ?? []);
  let spentNgn = input.todaySpentNgn;

  const quoteOf = (p: PaymentInfo) => input.quotes[p.id] ?? { fee: 0, total: p.amount };
  const base = (p: PaymentInfo) => ({ paymentId: p.id, amount: p.amount, currency: p.currency, fee: quoteOf(p).fee, notes: [] as string[] });

  /**
   * Best surplus wallet that can deliver `need` into `target`. Pair and rate are hard
   * limits here; a swap over the swap cap is still planned and flagged, so the policy
   * engine turns it into a proposal for the owner ("swap, or propose if over your limit").
   */
  function findSwap(target: Currency, need: number): { plan?: SwapPlan; blocked?: ReasonCode; overCap?: boolean } {
    if (!held.includes(target)) return { blocked: "PAIR_NOT_ALLOWED" };
    let blocked: ReasonCode | undefined;
    const sources = held.filter((c) => c !== target).sort((a, b) => ngn(available(b), b) - ngn(available(a), a));
    for (const source of sources) {
      if (!pairAllowed(policy, source, target)) {
        blocked ??= "PAIR_NOT_ALLOWED";
        continue;
      }
      const cost = swapCostFor(need, source, target, market.rates, market.swapFeeBps);
      if (available(source) < cost) continue;
      if (rateDeviationPct(source, target, market) > policy.maxRateDeviationPct) {
        blocked = "RATE_TOO_WIDE";
        continue;
      }
      return {
        plan: { from: source, to: target, amountType: "to", toAmount: need, fromAmount: cost, rate: crossRate(source, target, market.rates) },
        overCap: ngn(cost, source) > policy.perSwapCapNgn,
      };
    }
    return { blocked };
  }

  const ownPays: ProposedAction[] = [];
  const rebalances: ProposedAction[][] = []; // [swap, ...pays]
  const holds: ProposedAction[] = [];
  const defers: ProposedAction[] = [];
  const escalations: ProposedAction[] = [];
  const shorts = new Map<Currency, PaymentInfo[]>();

  const due = input.payments.filter((p) => (p.status === "SCHEDULED" || p.status === "DEFERRED") && p.dueDate <= today).sort(byPriority);

  // 1. Pay from the currency already held; queue the rest per currency, keeping priority.
  for (const p of due) {
    const cur = p.currency;
    const q = quoteOf(p);
    const owner: ReasonCode[] = [];
    if (!p.payee.allowlisted) owner.push("NEW_PAYEE");
    // The cap applies to what the payee receives; fees are shown separately.
    if (p.amount > (policy.perPaymentCap[cur] ?? 0)) owner.push("OVER_PAYMENT_CAP");
    if (spentNgn + ngn(q.total, cur) > policy.dailyCapNgn) owner.push("OVER_DAILY_CAP");
    if (owner.length) {
      const avail = available(cur);
      // A negative `available` means the wallet is already under its buffer: the swap must refill that too.
      const s = avail >= q.total ? null : findSwap(cur, q.total - avail);
      escalations.push({ ...base(p), type: "ESCALATE", reasonCode: owner[0], reasons: owner, plan: s?.plan ? { kind: "SWAP_THEN_PAY", swap: s.plan } : { kind: "PAY" } });
      continue;
    }
    spentNgn += ngn(q.total, cur);
    if (!shorts.has(cur) && available(cur) >= q.total) {
      ownPays.push({ ...base(p), type: "PAY", reasonCode: "ROUTINE_OK", reasons: ["ROUTINE_OK"] });
      reserved[cur] += q.total;
    } else {
      shorts.set(cur, [...(shorts.get(cur) ?? []), p]);
    }
  }

  function shortfall(p: PaymentInfo, blocked?: ReasonCode) {
    spentNgn -= ngn(quoteOf(p).total, p.currency);
    if (p.critical) {
      escalations.push({ ...base(p), type: "ESCALATE", reasonCode: blocked ?? "SHORTFALL_CRITICAL", reasons: [blocked ?? "SHORTFALL_CRITICAL"] });
    } else if (daysBetween(p.dueDate, today) >= policy.maxDeferDays) {
      escalations.push({ ...base(p), type: "ESCALATE", reasonCode: "MAX_DEFER_REACHED", reasons: ["MAX_DEFER_REACHED", blocked ?? "SHORTFALL_NON_CRITICAL"] });
    } else {
      defers.push({ ...base(p), type: "DEFER", reasonCode: blocked ?? "SHORTFALL_NON_CRITICAL", reasons: [blocked ?? "SHORTFALL_NON_CRITICAL"] });
    }
  }

  // 2 and 3. One rebalance per short currency, covering the longest run of bills in priority order.
  const rebalanced = new Set<Currency>();
  for (const [cur, list] of shorts) {
    if (pending.has(cur)) {
      for (const p of list) {
        spentNgn -= ngn(quoteOf(p).total, cur);
        holds.push({ ...base(p), type: "HOLD", reasonCode: "WAITING_FOR_REBALANCE", reasons: ["WAITING_FOR_REBALANCE"] });
      }
      continue;
    }
    let done = false;
    let blocked: ReasonCode | undefined = rejected.has(cur) ? "SHORTFALL_CRITICAL" : undefined;
    for (let k = list.length; k >= 1 && !rejected.has(cur); k--) {
      const covered = list.slice(0, k);
      const need = covered.reduce((s, p) => s + quoteOf(p).total, 0) - available(cur);
      const found = findSwap(cur, need);
      if (!found.plan) {
        // The reason the larger rebalance failed is why the left-out bills wait.
        blocked = found.blocked ?? blocked;
        continue;
      }
      const s = found.plan;
      const group: ProposedAction[] = [
        {
          type: "SWAP",
          reasonCode: "REBALANCE",
          reasons: found.overCap ? ["REBALANCE", "OVER_SWAP_CAP"] : ["REBALANCE"],
          amount: need,
          currency: cur,
          fee: 0,
          swap: s,
          covers: covered.map((p) => p.id),
          notes: [`${cur} is short for ${k} due ${k === 1 ? "bill" : "bills"}; ${s.from} has surplus above its buffer`],
        },
      ];
      balance[s.from] -= s.fromAmount;
      balance[cur] += s.toAmount;
      for (const p of covered) {
        group.push({ ...base(p), type: "PAY", reasonCode: "ROUTINE_OK", reasons: ["ROUTINE_OK"] });
        reserved[cur] += quoteOf(p).total;
      }
      rebalances.push(group);
      rebalanced.add(cur);
      for (const p of list.slice(k)) shortfall(p, blocked);
      done = true;
      break;
    }
    if (!done) for (const p of list) shortfall(p, blocked);
  }

  // Top-ups: future bills inside the horizon that would push a wallet below its buffer.
  const decided = new Set([...ownPays, ...rebalances.flat()].map((a) => a.paymentId).filter(Boolean));
  const outflows: Outflow[] = input.payments
    .filter((p) => !decided.has(p.id) && (p.status === "SCHEDULED" || p.status === "DEFERRED") && p.dueDate > today)
    .map((p) => ({ currency: p.currency, amount: quoteOf(p).total, dueDate: p.dueDate }));
  const fc = forecast({ today, horizonDays: policy.horizonDays, wallets: held.map((c) => ({ currency: c, blaaizWalletId: "", balance: balance[c] })), policy, outflows, reserved });
  const topUps: ProposedAction[] = [];
  for (const cur of held) {
    const f = fc[cur];
    if (!f?.belowBufferOn || pending.has(cur) || rebalanced.has(cur) || rejected.has(cur)) continue;
    const need = f.buffer - f.projected;
    if (need <= 0) continue;
    const found = findSwap(cur, need);
    const from = found.plan?.from ?? held.filter((c) => c !== cur).sort((a, b) => ngn(available(b), b) - ngn(available(a), a))[0];
    if (!from) continue;
    const swap: SwapPlan = found.plan ?? {
      from,
      to: cur,
      amountType: "to",
      toAmount: need,
      fromAmount: swapCostFor(need, from, cur, market.rates, market.swapFeeBps),
      rate: crossRate(from, cur, market.rates),
    };
    topUps.push({
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

  // Assemble in lifecycle order and link each funded payment to its swap.
  const actions: ProposedAction[] = [...ownPays];
  for (const group of rebalances) {
    const at = actions.length;
    actions.push(group[0], ...group.slice(1).map((a) => ({ ...a, after: at })));
  }
  actions.push(...holds, ...defers, ...escalations, ...topUps);
  return { actions, balancesAfter: balance };
}
