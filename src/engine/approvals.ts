// Owner decisions on proposals. Approve runs the executor immediately.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { audit } from "../lib/repo";
import { executeAction } from "./execute";

export async function approveAction(db: PrismaClient, client: BlaaizClient, actionId: string) {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.status !== "PENDING") return { status: "SKIPPED" as const, message: `Already ${action.status.toLowerCase()}` };
  const out = await executeAction(db, client, actionId, { ownerApproved: true });
  if (out.status === "EXECUTED" || out.status === "SKIPPED") {
    await db.action.update({ where: { id: actionId }, data: { decidedBy: "OWNER", decidedAt: new Date(), status: out.status === "EXECUTED" ? "EXECUTED" : "SKIPPED" } });
    await audit(db, "OWNER", `Approved proposal #${action.number}`, "Action", actionId);
  } else if (out.status === "BLOCKED") {
    await audit(db, "OWNER", `Approval of #${action.number} blocked: ${out.message}`, "Action", actionId);
  } else {
    await db.action.update({ where: { id: actionId }, data: { decidedBy: "OWNER", decidedAt: new Date() } });
  }
  return out;
}

export async function rejectAction(db: PrismaClient, actionId: string, note?: string) {
  const action = await db.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.status !== "PENDING") return;
  await db.action.update({ where: { id: actionId }, data: { status: "REJECTED", decidedBy: "OWNER", decidedAt: new Date() } });
  if (action.paymentId) {
    // Rejecting cancels this occurrence. Recurring payments keep their schedule.
    await db.scheduledPayment.update({ where: { id: action.paymentId }, data: { status: "CANCELLED" } });
  }
  await audit(db, "OWNER", `Rejected proposal #${action.number}${note ? `: ${note}` : ""}`, "Action", actionId);
}

export async function setPaused(db: PrismaClient, paused: boolean) {
  const c = await db.company.findFirstOrThrow();
  await db.company.update({ where: { id: c.id }, data: { paused } });
  await audit(db, "OWNER", paused ? "Paused Bursar. No execution until resumed." : "Resumed Bursar.", "Company", c.id);
}
