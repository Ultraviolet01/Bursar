// Turns Action rows into the labels the screens show.
import type { Action, Execution } from "@prisma/client";
import type { PolicyResult } from "../engine/policy";
import type { ProposedAction } from "../engine/types";
import type { Tone } from "../components/ui";
import { REASON_LABEL } from "../engine/explain";

export type ActionWithExec = Action & { executions: Execution[] };

export function parsed(a: Action) {
  return { proposal: JSON.parse(a.payload) as ProposedAction, policy: JSON.parse(a.policyResult) as PolicyResult };
}

export function outcome(a: Action): { label: string; tone: Tone } {
  if (a.status === "EXECUTED") return a.decidedBy === "OWNER" ? { label: "Approved", tone: "good" } : { label: "Auto", tone: "teal" };
  if (a.status === "PENDING") return { label: "Waiting", tone: "amber" };
  if (a.type === "HOLD") return { label: "Held", tone: "grey" };
  if (a.type === "RULE_CHANGE" && a.status === "EXECUTED") return { label: "Rule updated", tone: "good" };
  if (a.status === "REJECTED") return { label: "Rejected", tone: "bad" };
  if (a.status === "FAILED") return { label: "Failed", tone: "bad" };
  if (a.type === "DEFER") return { label: "Deferred", tone: "grey" };
  return { label: "Skipped", tone: "grey" };
}

export function kindLabel(a: Action): { label: string; tone: Tone } {
  const p = JSON.parse(a.payload) as ProposedAction;
  if (a.reasonCode === "PAYOUT_FAILED") return { label: "Payout failed", tone: "bad" };
  if (a.type === "RULE_CHANGE") return { label: "Rule suggestion", tone: "teal" };
  if (a.type === "SWAP" && a.reasonCode === "REBALANCE") return { label: "Rebalance", tone: "amber" };
  if (a.type === "SWAP") return { label: "Top-up swap", tone: "amber" };
  if (a.type === "ESCALATE" && p.plan?.kind === "SWAP_THEN_PAY") return { label: "Swap and pay", tone: "amber" };
  if (a.type === "ESCALATE") return { label: REASON_LABEL[a.reasonCode as keyof typeof REASON_LABEL] ?? "Needs you", tone: "amber" };
  return { label: "Payment", tone: "amber" };
}

export function title(a: Action, payeeName?: string): string {
  const p = JSON.parse(a.payload) as ProposedAction;
  switch (a.type) {
    case "SWAP":
      if (a.reasonCode === "REBALANCE") return `Rebalance ${p.swap?.from} to ${p.currency}`;
      return `Top up ${p.currency} from ${p.swap?.from}`;
    case "HOLD":
      return `Held ${payeeName ?? ""} for a rebalance`.replace("  ", " ");
    case "RULE_CHANGE": {
      const r = p.rule;
      if (!r) return "Rule suggestion";
      if (r.kind === "ALLOWLIST") return `Allowlist ${r.payeeName}`;
      if (r.kind === "UNALLOWLIST") return `Remove ${r.payeeName} from the allowlist`;
      return `${r.currency} per-payment cap`;
    }
    case "SWAP_THEN_PAY":
      return `Swapped and paid ${payeeName ?? ""}`.trim();
    case "PAY":
      return a.status === "EXECUTED" ? `Paid ${payeeName}` : `Pay ${payeeName}`;
    case "DEFER":
      return `Held back ${payeeName}`;
    case "ESCALATE":
      return `Pay ${payeeName}`;
    default:
      return a.type;
  }
}

export function reasonLabel(code: string): string {
  return REASON_LABEL[code as keyof typeof REASON_LABEL] ?? code;
}

export function proof(a: ActionWithExec): string | null {
  const payout = a.executions.find((e) => e.kind === "PAYOUT" && e.blaaizTransactionId);
  const swap = a.executions.find((e) => e.kind === "SWAP" && e.blaaizTransactionId);
  return payout?.blaaizTransactionId ?? swap?.blaaizTransactionId ?? null;
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}
