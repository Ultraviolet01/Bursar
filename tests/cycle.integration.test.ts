// End-to-end in mock mode against a throwaway SQLite database.
import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { getBlaaiz } from "../src/blaaiz";
import { MockBlaaizClient } from "../src/blaaiz/mock";
import { runCycle } from "../src/engine/cycle";
import { approveAction, setPaused } from "../src/engine/approvals";
import { handleBlaaizWebhook } from "../src/webhooks/handler";
import { signWebhook } from "../src/blaaiz/signature";

const client = new MockBlaaizClient(db, {
  webhookSecret: "test_secret",
  sink: (raw, sig, ts) => handleBlaaizWebhook(raw, sig, ts),
  delays: { processing: 60_000, final: 60_000 }, // settled manually below
});
(globalThis as { __bursarBlaaiz?: unknown }).__bursarBlaaiz = client;

async function settleAll(fail = false) {
  for (const t of await db.mockTransaction.findMany({ where: { type: "payout", status: "PENDING" } })) await client.settle(t.id, fail);
}

beforeEach(() => {
  execSync("npx tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "ignore" });
});

describe("cycle", () => {
  it("runs the demo cycle and never pays twice", async () => {
    expect(getBlaaiz()).toBe(client);
    const first = await runCycle(db, client, "MANUAL");
    expect(first.counts).toMatchObject({ paid: 5, waiting: 1 });
    await settleAll();
    const second = await runCycle(db, client, "MANUAL");
    expect(second.counts).toMatchObject({ paid: 0, waiting: 0 });
    const payouts = await db.execution.findMany({ where: { kind: "PAYOUT" } });
    expect(new Set(payouts.map((p) => p.idempotencyKey)).size).toBe(payouts.length);
    expect(await db.scheduledPayment.count({ where: { status: "PAID" } })).toBe(5);
  });

  it("keeps every wallet at or above its buffer after automated actions", async () => {
    await runCycle(db, client, "MANUAL");
    const w = await db.mockWallet.findMany();
    expect(Number(w.find((x) => x.currency === "NGN")!.balance)).toBeGreaterThanOrEqual(30_000_000);
    expect(Number(w.find((x) => x.currency === "USD")!.balance)).toBeGreaterThanOrEqual(20_000);
  });

  it("pausing stops all execution", async () => {
    await setPaused(db, true);
    const res = await runCycle(db, client, "MANUAL");
    expect(res.counts.paid).toBe(0);
    expect(await db.execution.count()).toBe(0);
    const pending = await db.action.findFirst({ where: { status: "PENDING" } });
    const out = await approveAction(db, client, pending!.id);
    expect(out.status).toBe("BLOCKED");
    expect(await db.execution.count()).toBe(0);
  });

  it("a failed payout releases the payment and creates an escalation", async () => {
    await db.payee.updateMany({ where: { name: "Ada Obi" }, data: { accountNumber: "0000000000" } });
    await runCycle(db, client, "MANUAL");
    const ada = await db.mockTransaction.findFirst({ where: { merchantReference: { contains: "pm_ada" } } });
    await client.settle(ada!.id, true);
    const pay = await db.scheduledPayment.findFirst({ where: { payee: { name: "Ada Obi" } } });
    expect(pay!.status).toBe("PROPOSED");
    expect(await db.action.findFirst({ where: { reasonCode: "PAYOUT_FAILED", status: "PENDING" } })).not.toBeNull();
  });

  it("owner approval runs the executor for an escalation", async () => {
    await db.policy.update({ where: { id: "default" }, data: { dailyCapNgn: 1_000_000_000n } });
    await runCycle(db, client, "MANUAL");
    const esc = await db.action.findFirstOrThrow({ where: { type: "ESCALATE", status: "PENDING" } });
    const out = await approveAction(db, client, esc.id);
    expect(out.status).toBe("EXECUTED");
    expect((await db.action.findUniqueOrThrow({ where: { id: esc.id } })).decidedBy).toBe("OWNER");
  });

  it("rejects webhooks with a bad signature and logs them", async () => {
    const body = JSON.stringify({ event: "payout.completed", data: { transaction_id: "x" } });
    const res = await handleBlaaizWebhook(body, "deadbeef", "1700000000");
    expect(res.status).toBe(401);
    expect(await db.webhookEvent.findFirst({ where: { signatureValid: false } })).not.toBeNull();
  });

  it("handles a duplicate webhook once", async () => {
    await runCycle(db, client, "MANUAL");
    const tx = await db.mockTransaction.findFirstOrThrow({ where: { type: "payout" } });
    const body = JSON.stringify({ event: "payout.completed", data: { transaction_id: tx.id, merchant_reference: tx.merchantReference } });
    const ts = "1700000000";
    const sig = signWebhook(body, ts, "test_secret");
    expect((await handleBlaaizWebhook(body, sig, ts)).body.message).toBe("Paid");
    expect((await handleBlaaizWebhook(body, sig, ts)).body.message).toBe("Duplicate");
  });
});
