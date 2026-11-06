// Plain-English, deterministic explanations. No LLM involved.
import { formatMoney } from "../lib/money";
import { shortDate } from "../lib/dates";
import type { ProposedAction, ReasonCode } from "./types";

export const REASON_LABEL: Record<ReasonCode, string> = {
  NEW_PAYEE: "New payee",
  OVER_PAYMENT_CAP: "Over per-payment cap",
  OVER_DAILY_CAP: "Over daily cap",
  OVER_SWAP_CAP: "Over swap cap",
  SHORTFALL_CRITICAL: "Shortfall, critical",
  SHORTFALL_NON_CRITICAL: "Shortfall, can wait",
  RATE_TOO_WIDE: "Rate too far from average",
  PAIR_NOT_ALLOWED: "Pair not allowed",
  MAX_DEFER_REACHED: "Deferred too long",
  PAUSED: "Bursar paused",
  BELOW_BUFFER_FORECAST: "Buffer at risk",
  PAYOUT_FAILED: "Payout failed",
  REBALANCE: "Rebalance for due bills",
  WAITING_FOR_REBALANCE: "Waiting for a rebalance",
  LEARNED: "Suggested from history",
  ROUTINE_OK: "Within all rules",
};

export function explain(a: ProposedAction, payeeName?: string, categoryLabel?: string): string {
  const amt = formatMoney(a.amount, a.currency);
  const who = payeeName ?? "payee";
  const reasons = a.reasons.map((r) => REASON_LABEL[r].toLowerCase()).join(" and ");
  switch (a.type) {
    case "PAY":
      return `Paid ${who} ${amt}. ${categoryLabel ? `Routine ${categoryLabel.toLowerCase()}, ` : ""}within caps, buffer kept.`;
    case "SWAP_THEN_PAY":
      return `Swapped ${formatMoney(a.swap!.fromAmount, a.swap!.from)} to ${formatMoney(a.swap!.toAmount, a.swap!.to)} to cover the shortfall, then paid ${who} ${amt}.`;
    case "DEFER":
      return `Held back ${who} ${amt}: ${reasons}. Not critical, so it waits for the next cycle.`;
    case "ESCALATE":
      return `Needs you to pay ${who} ${amt}: ${reasons}.`;
    case "SWAP":
      if (a.reasonCode === "REBALANCE")
        return `Rebalanced: swapped ${formatMoney(a.swap!.fromAmount, a.swap!.from)} into ${formatMoney(a.swap!.toAmount, a.currency)} so ${a.covers?.length ?? 0} due ${a.covers?.length === 1 ? "bill" : "bills"} in ${a.currency} can be paid. ${a.swap!.from} stays above its buffer.`;
      return `Top up ${a.currency} by ${amt} from ${a.swap!.from}. ${a.notes[0] ? a.notes[0].replace(/on (\d{4}-\d{2}-\d{2})/, (_, d) => `on ${shortDate(d)}`) : ""}.`;
    case "HOLD":
      return `Holding ${who} ${amt} until the ${a.currency} rebalance waiting for you is approved.`;
    case "RULE_CHANGE": {
      const r = a.rule!;
      if (r.kind === "ALLOWLIST") return `You approved ${r.payeeName} ${r.approvals} times. Add them to the allowlist so routine payments run alone?`;
      if (r.kind === "UNALLOWLIST") return `You rejected payments to ${r.payeeName} ${r.rejections} times. Remove them from the allowlist?`;
      return `You approved ${r.approvals} payments over the ${r.currency} per-payment cap. Raise it from ${formatMoney(r.from, r.currency, { decimals: false })} to ${formatMoney(r.to, r.currency, { decimals: false })}?`;
    }
    default:
      return `${a.type} ${amt}`;
  }
}
