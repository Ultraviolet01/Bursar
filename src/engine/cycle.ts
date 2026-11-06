// Runs the lifecycle for one company and writes Cycle, Action and AuditLog rows:
//   Observe -> Forecast -> Decide -> Act (preview, policy, execute or propose) -> Reconcile -> Learn
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import type { Currency } from "../lib/money";
import { audit, nextActionNumber } from "../lib/repo";
import { CATEGORY_LABEL, type ProposedAction } from "./types";
import { decide } from "./decide";
import { explain } from "./explain";
import { executeAction } from "./execute";
import { forecast } from "./forecast";
import { learn } from "./learn";
import { observe, syncWallets, todaySpentNgn } from "./observe";
import { evaluate } from "./policy";
import { reconcileOpen } from "./reconcile";

/** SCHEDULE: cron. MANUAL: Run cycle. WEBHOOK: money arrived. BILL: a bill was added. APPROVAL: an approved rebalance freed funds. */
export type CycleTrigger = "SCHEDULE" | "MANUAL" | "WEBHOOK" | "BILL" | "APPROVAL";

// One cycle at a time per company.
const g = globalThis as unknown as { __bursarCycles?: Set<string> };
const running = (g.__bursarCycles ??= new Set());

export function isCycleRunning(companyId: string) {
  return running.has(companyId);
}

/** Event-driven run. Never throws; skips quietly if a cycle is already running. */
export async function triggerCycle(companyId: string, trigger: CycleTrigger) {
  if (running.has(companyId)) return null;
  try {
    const [{ db }, { getBlaaiz }] = await Promise.all([import("../lib/db"), import("../blaaiz")]);
    return await runCycle(db, await getBlaaiz(companyId), companyId, trigger);
  } catch {
    return null;
  }
}

const isMoney = (a: ProposedAction) => a.type === "PAY" || a.type === "SWAP_THEN_PAY" || a.type === "SWAP";

export async function runCycle(db: PrismaClient, client: BlaaizClient, companyId: string, trigger: CycleTrigger, today?: string) {
  if (running.has(companyId)) throw new Error("A cycle is already running for this company");
  running.add(companyId);
  const cycle = await db.cycle.create({ data: { companyId, trigger } });
  try {
    // 1. Observe
    const obs = await observe(db, client, companyId, cycle.id, today);

    // 2. Forecast (for the summary; decide re-forecasts after its own reservations)
    const fc = forecast({
      today: obs.today,
      horizonDays: obs.policy.horizonDays,
      wallets: obs.wallets,
      policy: obs.policy,
      outflows: obs.payments.map((p) => ({ currency: p.currency, amount: obs.quotes[p.id]?.total ?? p.amount, dueDate: p.dueDate })),
    });

    // 3. Decide
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [pendingSwapRows, rejectedSwapRows] = await Promise.all([
      db.action.findMany({ where: { companyId, type: "SWAP", status: "PENDING" } }),
      db.action.findMany({ where: { companyId, type: "SWAP", status: "REJECTED", decidedAt: { gte: startOfDay } } }),
    ]);
    const cur = (rows: { payload: string }[]) => rows.map((a) => (JSON.parse(a.payload) as { currency: Currency }).currency);
    const { actions } = decide({ ...obs, pendingSwaps: cur(pendingSwapRows), rejectedSwapsToday: cur(rejectedSwapRows) });

    // 4. Act, in lifecycle order. A PAY funded by a rebalance only runs if that swap ran.
    const counts = { paid: 0, swapped: 0, waiting: 0, held: 0, deferred: 0, failed: 0, learned: 0 };
    const payees = new Map(obs.payments.map((p) => [p.id, p.payee]));
    const outcome = new Map<number, { status: string; number: number }>();

    for (const [i, a] of actions.entries()) {
      const payee = a.paymentId ? payees.get(a.paymentId) : undefined;

      // Funded by a rebalance that is waiting for the owner: hold, don't propose twice.
      const parent = a.after !== undefined ? outcome.get(a.after) : undefined;
      if (a.type === "HOLD" || (parent && parent.status !== "EXECUTED")) {
        counts.held++;
        const already = await db.action.findFirst({ where: { companyId, paymentId: a.paymentId, type: "HOLD", createdAt: { gte: startOfDay } } });
        if (already) continue;
        const hold: ProposedAction = { ...a, type: "HOLD", reasonCode: "WAITING_FOR_REBALANCE", reasons: ["WAITING_FOR_REBALANCE"] };
        const explanation = `${explain(hold, payee?.name)}${parent ? ` See proposal #${parent.number}.` : ""}`;
        const row = await db.action.create({
          data: { companyId, number: await nextActionNumber(db, companyId), cycleId: cycle.id, type: "HOLD", paymentId: a.paymentId, payload: JSON.stringify(hold), reasonCode: "WAITING_FOR_REBALANCE", explanation, policyResult: JSON.stringify({ checks: [], autoOk: false, ownerOk: true }), status: "SKIPPED" },
        });
        await audit(db, companyId, "BURSAR", explanation, "Action", row.id);
        continue;
      }

      // Check against live state: earlier actions in this cycle have already moved money.
      const live = { ...obs, wallets: await syncWallets(db, client, companyId), todaySpentNgn: await todaySpentNgn(db, companyId, obs.market.rates) };
      const precheck = evaluate(a, { ...live, payee });
      const canAuto = isMoney(a) && precheck.autoOk;
      const reasonCode = obs.paused && isMoney(a) ? "PAUSED" : a.reasonCode;
      let explanation = explain(a, payee?.name, payee ? CATEGORY_LABEL[payee.category] : undefined);
      if (a.covers?.length) {
        const names = a.covers.map((id) => payees.get(id)?.name).filter(Boolean);
        explanation += ` Covers: ${names.join(", ")}.`;
      }
      if (!canAuto && isMoney(a)) {
        const blockers = precheck.checks.filter((c) => c.status !== "pass").map((c) => c.label.toLowerCase());
        explanation = `Proposed: ${explanation.replace(/^Paid/, "pay").replace(/^Swapped/, "swap").replace(/^Rebalanced: swapped/, "rebalance by swapping")} Waiting because: ${blockers.join(", ")}.`;
      }
      const number = await nextActionNumber(db, companyId);
      const row = await db.action.create({
        data: {
          companyId,
          number,
          cycleId: cycle.id,
          type: a.type,
          paymentId: a.paymentId,
          payload: JSON.stringify(a),
          reasonCode,
          explanation,
          policyResult: JSON.stringify(precheck),
          status: a.type === "DEFER" ? "SKIPPED" : "PENDING",
          auto: canAuto,
        },
      });

      if (a.type === "DEFER") {
        counts.deferred++;
        outcome.set(i, { status: "SKIPPED", number });
        await db.scheduledPayment.update({ where: { id: a.paymentId! }, data: { status: "DEFERRED", deferCount: { increment: 1 } } });
        await audit(db, companyId, "BURSAR", explanation, "Action", row.id);
        continue;
      }
      if (canAuto) {
        const out = await executeAction(db, client, row.id, { ownerApproved: false });
        outcome.set(i, { status: out.status, number });
        if (out.status === "EXECUTED") {
          await db.action.update({ where: { id: row.id }, data: { decidedBy: "BURSAR", decidedAt: new Date() } });
          if (a.type === "SWAP") counts.swapped++;
          else counts.paid++;
          if (a.type === "SWAP_THEN_PAY") counts.swapped++;
          continue;
        }
        if (out.status === "FAILED") {
          counts.failed++;
          continue;
        }
        // Blocked by the live re-check: fall through to a proposal.
        await db.action.update({ where: { id: row.id }, data: { auto: false, explanation: `${explanation} Live check: ${out.message}` } });
      }
      outcome.set(i, { status: "PENDING", number });
      counts.waiting++;
      if (a.paymentId) await db.scheduledPayment.update({ where: { id: a.paymentId }, data: { status: "PROPOSED" } });
      await audit(db, companyId, "BURSAR", explanation, "Action", row.id);
    }

    // 5. Reconcile
    await reconcileOpen(db, client, companyId);
    await syncWallets(db, client, companyId);

    // 6. Learn
    counts.learned = await learn(db, companyId, cycle.id);

    const below = Object.values(fc).filter((f) => f?.belowBufferOn);
    const parts = [
      counts.paid && `${counts.paid} paid`,
      counts.swapped && `${counts.swapped} swap${counts.swapped > 1 ? "s" : ""}`,
      counts.waiting && `${counts.waiting} waiting for you`,
      counts.held && `${counts.held} held for a rebalance`,
      counts.deferred && `${counts.deferred} deferred`,
      counts.failed && `${counts.failed} failed`,
      counts.learned && `${counts.learned} rule suggestion${counts.learned > 1 ? "s" : ""}`,
    ].filter(Boolean);
    const summary = parts.length
      ? parts.join(", ")
      : `Nothing due. ${below.length ? `${below.map((b) => b!.currency).join(", ")} near buffer within horizon.` : "All wallets above buffer for the horizon."}`;
    await db.cycle.update({ where: { id: cycle.id }, data: { finishedAt: new Date(), summary } });
    await audit(db, companyId, "BURSAR", `Cycle finished (${trigger.toLowerCase()}): ${summary}`, "Cycle", cycle.id);
    return { cycleId: cycle.id, summary, counts };
  } catch (e) {
    await db.cycle.update({ where: { id: cycle.id }, data: { finishedAt: new Date(), error: String(e).slice(0, 500) } });
    await audit(db, companyId, "BURSAR", `Cycle failed: ${String(e).slice(0, 200)}`, "Cycle", cycle.id);
    throw e;
  } finally {
    running.delete(companyId);
  }
}
