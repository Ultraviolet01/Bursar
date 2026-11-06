// Runs the five stages and writes Cycle, Action and AuditLog rows.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import type { Currency } from "../lib/money";
import { audit, nextActionNumber } from "../lib/repo";
import { CATEGORY_LABEL } from "./types";
import { decide } from "./decide";
import { explain } from "./explain";
import { executeAction } from "./execute";
import { forecast } from "./forecast";
import { observe, syncWallets, todaySpentNgn } from "./observe";
import { evaluate } from "./policy";
import { reconcileOpen } from "./reconcile";

export type CycleTrigger = "SCHEDULE" | "MANUAL" | "WEBHOOK";

const g = globalThis as unknown as { __bursarCycleRunning?: boolean };

export async function runCycle(db: PrismaClient, client: BlaaizClient, trigger: CycleTrigger, today?: string) {
  if (g.__bursarCycleRunning) throw new Error("A cycle is already running");
  g.__bursarCycleRunning = true;
  const cycle = await db.cycle.create({ data: { trigger } });
  try {
    // 1. Observe
    const obs = await observe(db, client, cycle.id, today);

    // 2. Forecast (for the summary; decide re-forecasts after its own reservations)
    const fc = forecast({
      today: obs.today,
      horizonDays: obs.policy.horizonDays,
      wallets: obs.wallets,
      policy: obs.policy,
      outflows: obs.payments.map((p) => ({ currency: p.currency, amount: obs.quotes[p.id]?.total ?? p.amount, dueDate: p.dueDate })),
    });

    // 3. Decide
    const pendingSwaps = await db.action.findMany({ where: { type: "SWAP", status: "PENDING" } });
    const pendingTopUps = pendingSwaps.map((a) => (JSON.parse(a.payload) as { currency: Currency }).currency);
    const { actions } = decide({ ...obs, pendingTopUps });

    // 4. Act
    const counts = { paid: 0, swapped: 0, waiting: 0, deferred: 0, failed: 0 };
    const payees = new Map(obs.payments.map((p) => [p.id, p.payee]));
    for (const a of actions) {
      const payee = a.paymentId ? payees.get(a.paymentId) : undefined;
      // Check against live state: earlier actions in this cycle have already moved money.
      const live = { ...obs, wallets: await syncWallets(db, client), todaySpentNgn: await todaySpentNgn(db, obs.market.usdNgn) };
      const precheck = evaluate(a, { ...live, payee });
      const canAuto = (a.type === "PAY" || a.type === "SWAP_THEN_PAY" || a.type === "SWAP") && precheck.autoOk;
      const reasonCode = obs.paused && (a.type === "PAY" || a.type === "SWAP_THEN_PAY") ? "PAUSED" : a.reasonCode;
      let explanation = explain(a, payee?.name, payee ? CATEGORY_LABEL[payee.category] : undefined);
      if (!canAuto && (a.type === "PAY" || a.type === "SWAP_THEN_PAY" || a.type === "SWAP")) {
        const blockers = precheck.checks.filter((c) => c.status !== "pass").map((c) => c.label.toLowerCase());
        explanation = `Proposed: ${explanation.replace(/^Paid/, "pay").replace(/^Swapped/, "swap")} Waiting because: ${blockers.join(", ")}.`;
      }
      const row = await db.action.create({
        data: {
          number: await nextActionNumber(db),
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
        await db.scheduledPayment.update({ where: { id: a.paymentId! }, data: { status: "DEFERRED", deferCount: { increment: 1 } } });
        await audit(db, "BURSAR", explanation, "Action", row.id);
        continue;
      }
      if (canAuto) {
        const out = await executeAction(db, client, row.id, { ownerApproved: false });
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
      counts.waiting++;
      if (a.paymentId) await db.scheduledPayment.update({ where: { id: a.paymentId }, data: { status: "PROPOSED" } });
      await audit(db, "BURSAR", explanation, "Action", row.id);
    }

    // 5. Reconcile
    await reconcileOpen(db, client);
    await syncWallets(db, client);

    const below = (Object.values(fc) as { currency: string; belowBufferOn: string | null }[]).filter((f) => f.belowBufferOn);
    const summary =
      actions.length === 0
        ? `Nothing due. ${below.length ? `${below.map((b) => b.currency).join(", ")} near buffer within horizon.` : "All wallets above buffer for the horizon."}`
        : [
            counts.paid && `${counts.paid} paid`,
            counts.swapped && `${counts.swapped} swap${counts.swapped > 1 ? "s" : ""}`,
            counts.waiting && `${counts.waiting} waiting for you`,
            counts.deferred && `${counts.deferred} deferred`,
            counts.failed && `${counts.failed} failed`,
          ]
            .filter(Boolean)
            .join(", ");
    await db.cycle.update({ where: { id: cycle.id }, data: { finishedAt: new Date(), summary } });
    await audit(db, "BURSAR", `Cycle finished (${trigger.toLowerCase()}): ${summary}`, "Cycle", cycle.id);
    return { cycleId: cycle.id, summary, counts };
  } catch (e) {
    await db.cycle.update({ where: { id: cycle.id }, data: { finishedAt: new Date(), error: String(e).slice(0, 500) } });
    await audit(db, "BURSAR", `Cycle failed: ${String(e).slice(0, 200)}`, "Cycle", cycle.id);
    throw e;
  } finally {
    g.__bursarCycleRunning = false;
  }
}
