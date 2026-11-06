// Owner decisions on proposals. Approve runs the executor immediately.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { audit } from "../lib/repo";
import { executeAction } from "./execute";
import { applyRuleChange } from "./learn";
import type { ProposedAction } from "./types";

export async function approveAction(db: PrismaClient, client: BlaaizClient, actionId: string) {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.status !== "PENDING") return { status: "SKIPPED" as const, message: `Already ${action.status.toLowerCase()}` };
  const proposal = JSON.parse(action.payload) as ProposedAction;

  // Rule suggestions from the Learn stage change settings, never money.
  if (action.type === "RULE_CHANGE" && proposal.rule) {
    await applyRuleChange(db, action.companyId, proposal.rule);
    await db.action.update({ where: { id: actionId }, data: { status: "EXECUTED", decidedBy: "OWNER", decidedAt: new Date() } });
    await audit(db, action.companyId, "OWNER", `Accepted suggestion #${action.number}: ${action.explanation}`, "Action", actionId);
    return { status: "EXECUTED" as const, message: "Rule updated" };
  }

  const out = await executeAction(db, client, actionId, { ownerApproved: true });
  if (out.status === "EXECUTED" || out.status === "SKIPPED") {
    await db.action.update({ where: { id: actionId }, data: { decidedBy: "OWNER", decidedAt: new Date(), status: out.status === "EXECUTED" ? "EXECUTED" : "SKIPPED" } });
    await audit(db, action.companyId, "OWNER", `Approved proposal #${action.number}`, "Action", actionId);
    // An approved swap frees funds for bills that were held: run a cycle to pay them.
    if (out.status === "EXECUTED" && action.type === "SWAP") {
      const { triggerCycle } = await import("./cycle");
      await triggerCycle(action.companyId, "APPROVAL");
    }
  } else if (out.status === "BLOCKED") {
    await audit(db, action.companyId, "OWNER", `Approval of #${action.number} blocked: ${out.message}`, "Action", actionId);
  } else {
    await db.action.update({ where: { id: actionId }, data: { decidedBy: "OWNER", decidedAt: new Date() } });
  }
  return out;
}

export async function rejectAction(db: PrismaClient, actionId: string, note?: string) {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.status !== "PENDING") return;
  await db.action.update({ where: { id: actionId }, data: { status: "REJECTED", decidedBy: "OWNER", decidedAt: new Date() } });
  if (action.paymentId && action.type !== "RULE_CHANGE") {
    // Rejecting cancels this occurrence. Recurring payments keep their schedule.
    await db.scheduledPayment.update({ where: { id: action.paymentId }, data: { status: "CANCELLED" } });
  }
  await audit(db, action.companyId, "OWNER", `Rejected proposal #${action.number}${note ? `: ${note}` : ""}`, "Action", actionId);
}

export async function setPaused(db: PrismaClient, companyId: string, paused: boolean) {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  await db.company.update({ where: { id: c.id }, data: { paused } });
  await audit(db, c.id, "OWNER", paused ? "Paused Bursar. No execution until resumed." : "Resumed Bursar.", "Company", c.id);
}
