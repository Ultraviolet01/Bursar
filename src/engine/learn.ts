// Stage 6. Learn. Reads outcomes (what the owner approved or rejected, the rates
// swaps got) and turns repeated patterns into rule suggestions the owner can accept.
// Suggestions are proposals like any other: nothing changes until the owner approves.
import type { PrismaClient } from "@prisma/client";
import { bn, type Currency, crossRate, isCurrency, type Rates } from "../lib/money";
import { audit, loadPolicy, nextActionNumber } from "../lib/repo";
import { explain } from "./explain";
import type { ProposedAction, RuleChange } from "./types";

const DAY = 86_400_000;

function ruleKey(r: RuleChange): string {
  return r.kind === "RAISE_CAP" ? `RAISE_CAP:${r.currency}` : `${r.kind}:${r.payeeId}`;
}

/** Round a cap up to a figure a person would pick (2 significant digits). */
export function niceCeil(minor: number): number {
  const major = Math.ceil(minor / 100);
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(major)) - 1));
  return Math.ceil(major / mag) * mag * 100;
}

export interface Outcomes {
  decided: number;
  approved: number;
  rejected: number;
  byReason: { reason: string; approved: number; rejected: number }[];
  swaps: { count: number; avgVsAveragePct: number | null };
  deferred: number;
  deferredLaterPaid: number;
}

/** Pure-ish summary used by the Learn stage and the Insights panel. */
export async function outcomes(db: PrismaClient, companyId: string, days = 30): Promise<Outcomes> {
  const since = new Date(Date.now() - days * DAY);
  const decided = await db.action.findMany({ where: { companyId, decidedBy: "OWNER", decidedAt: { gte: since }, type: { not: "RULE_CHANGE" } } });
  const reasons = new Map<string, { approved: number; rejected: number }>();
  for (const a of decided) {
    const r = reasons.get(a.reasonCode) ?? { approved: 0, rejected: 0 };
    if (a.status === "REJECTED") r.rejected++;
    else r.approved++;
    reasons.set(a.reasonCode, r);
  }

  // How the rates swaps actually got compare with the 7-day average at the time.
  const swaps = await db.execution.findMany({ where: { companyId, kind: "SWAP", status: "SUCCESSFUL", createdAt: { gte: since } } });
  const devs: number[] = [];
  for (const e of swaps) {
    const res = JSON.parse(e.response ?? "{}") as { rate?: number; fromAmount?: number; toAmount?: number };
    const action = await db.action.findUnique({ where: { id: e.actionId } });
    const p = action ? (JSON.parse(action.payload) as ProposedAction) : null;
    const from = p?.swap?.from;
    const to = p?.swap?.to;
    if (!from || !to || !res.rate) continue;
    const window = await db.rateSnapshot.findMany({ where: { fetchedAt: { gte: new Date(e.createdAt.getTime() - 7 * DAY), lte: e.createdAt } } });
    const avg = (c: Currency) => {
      if (c === "NGN") return 1;
      const rows = window.filter((w) => w.pair === `${c}NGN`);
      return rows.length ? rows.reduce((s, r) => s + r.rate, 0) / rows.length : NaN;
    };
    const avgCross = crossRate(from, to, { NGN: 1, USD: avg("USD"), EUR: avg("EUR"), GBP: avg("GBP") } as Rates);
    if (Number.isFinite(avgCross)) devs.push(((res.rate - avgCross) / avgCross) * 100);
  }

  const deferredActions = await db.action.findMany({ where: { companyId, type: "DEFER", createdAt: { gte: since } }, select: { paymentId: true } });
  const deferredIds = [...new Set(deferredActions.map((d) => d.paymentId).filter((x): x is string => !!x))];
  const laterPaid = deferredIds.length ? await db.scheduledPayment.count({ where: { id: { in: deferredIds }, status: "PAID" } }) : 0;

  return {
    decided: decided.length,
    approved: decided.filter((a) => a.status !== "REJECTED").length,
    rejected: decided.filter((a) => a.status === "REJECTED").length,
    byReason: [...reasons.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected)),
    swaps: { count: swaps.length, avgVsAveragePct: devs.length ? devs.reduce((s, d) => s + d, 0) / devs.length : null },
    deferred: deferredIds.length,
    deferredLaterPaid: laterPaid,
  };
}

/** Finds repeated owner decisions and proposes rule changes. Returns how many were proposed. */
export async function learn(db: PrismaClient, companyId: string, cycleId?: string): Promise<number> {
  const since60 = new Date(Date.now() - 60 * DAY);
  const since30 = new Date(Date.now() - 30 * DAY);
  const [decided, existing, policy, payees] = await Promise.all([
    db.action.findMany({ where: { companyId, decidedBy: "OWNER", decidedAt: { gte: since60 }, paymentId: { not: null } }, orderBy: { decidedAt: "asc" } }),
    db.action.findMany({ where: { companyId, type: "RULE_CHANGE", OR: [{ status: "PENDING" }, { decidedAt: { gte: since30 } }] } }),
    loadPolicy(db, companyId),
    db.payee.findMany({ where: { companyId } }),
  ]);
  const taken = new Set(existing.map((a) => ruleKey((JSON.parse(a.payload) as ProposedAction).rule!)));
  const payments = await db.scheduledPayment.findMany({ where: { companyId, id: { in: decided.map((a) => a.paymentId!) } } });
  const payeeOf = new Map(payments.map((p) => [p.id, p.payeeId]));
  const suggestions: RuleChange[] = [];

  for (const payee of payees) {
    const mine = decided.filter((a) => payeeOf.get(a.paymentId!) === payee.id);
    const approved = mine.filter((a) => a.status === "EXECUTED");
    const rejected = mine.filter((a) => a.status === "REJECTED");
    if (!payee.allowlisted && approved.length >= 2) suggestions.push({ kind: "ALLOWLIST", payeeId: payee.id, payeeName: payee.name, approvals: approved.length });
    const lastApproved = approved.at(-1)?.decidedAt?.getTime() ?? 0;
    const recentRejections = rejected.filter((a) => (a.decidedAt?.getTime() ?? 0) > lastApproved);
    if (payee.allowlisted && recentRejections.length >= 2) suggestions.push({ kind: "UNALLOWLIST", payeeId: payee.id, payeeName: payee.name, rejections: recentRejections.length });
  }

  const overCap = decided.filter((a) => a.status === "EXECUTED" && (a.decidedAt?.getTime() ?? 0) >= since30.getTime() && (JSON.parse(a.payload) as ProposedAction).reasons.includes("OVER_PAYMENT_CAP"));
  const byCurrency = new Map<Currency, number[]>();
  for (const a of overCap) {
    const p = JSON.parse(a.payload) as ProposedAction;
    if (isCurrency(p.currency)) byCurrency.set(p.currency, [...(byCurrency.get(p.currency) ?? []), p.amount]);
  }
  for (const [currency, amounts] of byCurrency) {
    if (amounts.length < 3) continue;
    const from = policy.perPaymentCap[currency] ?? 0;
    const to = niceCeil(Math.max(...amounts));
    if (to > from) suggestions.push({ kind: "RAISE_CAP", currency, from, to, approvals: amounts.length });
  }

  let made = 0;
  for (const rule of suggestions) {
    if (taken.has(ruleKey(rule))) continue;
    const proposal: ProposedAction = {
      type: "RULE_CHANGE",
      reasonCode: "LEARNED",
      reasons: ["LEARNED"],
      amount: rule.kind === "RAISE_CAP" ? rule.to : 0,
      currency: rule.kind === "RAISE_CAP" ? rule.currency : "NGN",
      fee: 0,
      rule,
      notes: [],
    };
    await db.action.create({
      data: {
        companyId,
        cycleId,
        number: await nextActionNumber(db, companyId),
        type: "RULE_CHANGE",
        payload: JSON.stringify(proposal),
        reasonCode: "LEARNED",
        explanation: explain(proposal),
        policyResult: JSON.stringify({ checks: [], autoOk: false, ownerOk: true }),
        status: "PENDING",
      },
    });
    await audit(db, companyId, "BURSAR", `Learned: ${explain(proposal)}`, "RuleChange", ruleKey(rule));
    made++;
  }
  return made;
}

/** Applies an approved rule change. Rule changes never move money. */
export async function applyRuleChange(db: PrismaClient, companyId: string, rule: RuleChange) {
  if (rule.kind === "ALLOWLIST" || rule.kind === "UNALLOWLIST") {
    const allow = rule.kind === "ALLOWLIST";
    await db.payee.updateMany({ where: { id: rule.payeeId, companyId }, data: { allowlisted: allow, ...(allow ? { verifiedAt: new Date() } : {}) } });
    return;
  }
  const p = await db.policy.findUniqueOrThrow({ where: { companyId } });
  const caps = JSON.parse(p.perPaymentCap) as Record<string, number>;
  caps[rule.currency] = rule.to;
  await db.policy.update({ where: { companyId }, data: { perPaymentCap: JSON.stringify(caps) } });
}

export { bn };
