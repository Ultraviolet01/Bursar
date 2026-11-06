// End-to-end in mock mode against a throwaway SQLite database.
import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { setBlaaiz } from "../src/blaaiz";
import { MockBlaaizClient } from "../src/blaaiz/mock";
import { runCycle } from "../src/engine/cycle";
import { approveAction, setPaused } from "../src/engine/approvals";
import { handleBlaaizWebhook } from "../src/webhooks/handler";
import { signWebhook } from "../src/blaaiz/signature";

let companyId = "";
let otherId = "";
let client: MockBlaaizClient;

function mockFor(id: string) {
  const c = new MockBlaaizClient(db, {
    companyId: id,
    webhookSecret: "test_secret",
    sink: (raw, sig, ts) => handleBlaaizWebhook(id, raw, sig, ts),
    delays: { processing: 60_000, final: 60_000 }, // settled manually below
  });
  setBlaaiz(id, c);
  return c;
}

async function settleAll(fail = false) {
  for (const t of await db.mockTransaction.findMany({ where: { companyId, type: "payout", status: "PENDING" } })) await client.settle(t.id, fail);
}

beforeEach(async () => {
  execSync("npx tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "ignore" });
  companyId = (await db.company.findFirstOrThrow({ where: { name: "Kaduna Freight Ltd" } })).id;
  otherId = (await db.company.findFirstOrThrow({ where: { name: "Ilorin Agro Foods" } })).id;
  client = mockFor(companyId);
  mockFor(otherId);
});

describe("cycle", () => {
  it("runs the demo cycle and never pays twice", async () => {
    const first = await runCycle(db, client, companyId, "MANUAL");
    expect(first.counts).toMatchObject({ paid: 5, waiting: 1 });
    await settleAll();
    const second = await runCycle(db, client, companyId, "MANUAL");
    expect(second.counts).toMatchObject({ paid: 0, waiting: 0 });
    const payouts = await db.execution.findMany({ where: { kind: "PAYOUT" } });
    expect(new Set(payouts.map((p) => p.idempotencyKey)).size).toBe(payouts.length);
    expect(await db.scheduledPayment.count({ where: { companyId, status: "PAID" } })).toBe(5);
  });

  it("keeps every wallet at or above its buffer after automated actions", async () => {
    await runCycle(db, client, companyId, "MANUAL");
    const w = await db.mockWallet.findMany({ where: { companyId } });
    expect(Number(w.find((x) => x.currency === "NGN")!.balance)).toBeGreaterThanOrEqual(30_000_000);
    expect(Number(w.find((x) => x.currency === "USD")!.balance)).toBeGreaterThanOrEqual(20_000);
  });

  it("pausing stops all execution", async () => {
    await setPaused(db, companyId, true);
    const res = await runCycle(db, client, companyId, "MANUAL");
    expect(res.counts.paid).toBe(0);
    expect(await db.execution.count()).toBe(0);
    const pending = await db.action.findFirst({ where: { companyId, status: "PENDING" } });
    const out = await approveAction(db, client, pending!.id);
    expect(out.status).toBe("BLOCKED");
    expect(await db.execution.count()).toBe(0);
  });

  it("a failed payout releases the payment and creates an escalation", async () => {
    await db.payee.updateMany({ where: { companyId, name: "Ada Obi" }, data: { accountNumber: "0000000000" } });
    await runCycle(db, client, companyId, "MANUAL");
    const ada = await db.mockTransaction.findFirst({ where: { companyId, merchantReference: { contains: "pm_ada" } } });
    await client.settle(ada!.id, true);
    const pay = await db.scheduledPayment.findFirst({ where: { companyId, payee: { name: "Ada Obi" } } });
    expect(pay!.status).toBe("PROPOSED");
    expect(await db.action.findFirst({ where: { companyId, reasonCode: "PAYOUT_FAILED", status: "PENDING" } })).not.toBeNull();
    const w = await db.mockWallet.findFirstOrThrow({ where: { companyId, currency: "NGN" } });
    expect(Number(w.balance)).toBeGreaterThan(0);
  });

  it("owner approval runs the executor for an escalation", async () => {
    await db.policy.update({ where: { companyId }, data: { dailyCapNgn: 1_000_000_000n } });
    await runCycle(db, client, companyId, "MANUAL");
    const esc = await db.action.findFirstOrThrow({ where: { companyId, type: "ESCALATE", status: "PENDING" } });
    const out = await approveAction(db, client, esc.id);
    expect(out.status).toBe("EXECUTED");
    expect((await db.action.findUniqueOrThrow({ where: { id: esc.id } })).decidedBy).toBe("OWNER");
  });

  it("rejects webhooks with a bad signature and logs them", async () => {
    const body = JSON.stringify({ event: "payout.completed", data: { transaction_id: "x" } });
    const res = await handleBlaaizWebhook(companyId, body, "deadbeef", "1700000000");
    expect(res.status).toBe(401);
    expect(await db.webhookEvent.findFirst({ where: { companyId, signatureValid: false } })).not.toBeNull();
  });

  it("handles a duplicate webhook once", async () => {
    await runCycle(db, client, companyId, "MANUAL");
    const tx = await db.mockTransaction.findFirstOrThrow({ where: { companyId, type: "payout" } });
    const body = JSON.stringify({ event: "payout.completed", data: { transaction_id: tx.id, merchant_reference: tx.merchantReference } });
    const ts = "1700000000";
    const sig = signWebhook(body, ts, "test_secret");
    expect((await handleBlaaizWebhook(companyId, body, sig, ts)).body.message).toBe("Paid");
    expect((await handleBlaaizWebhook(companyId, body, sig, ts)).body.message).toBe("Duplicate");
  });
});

describe("multiple companies", () => {
  it("a cycle for one company never touches another company's money or records", async () => {
    const before = await db.mockWallet.findMany({ where: { companyId: otherId } });
    await runCycle(db, client, companyId, "MANUAL");
    const after = await db.mockWallet.findMany({ where: { companyId: otherId } });
    expect(after.map((w) => w.balance)).toEqual(before.map((w) => w.balance));
    expect(await db.action.count({ where: { companyId: otherId } })).toBe(0);
    expect(await db.scheduledPayment.count({ where: { companyId: otherId, status: { not: "SCHEDULED" } } })).toBe(0);
  });

  it("each company numbers its own proposals from 1", async () => {
    await runCycle(db, client, companyId, "MANUAL");
    const other = mockFor(otherId);
    await runCycle(db, other, otherId, "MANUAL");
    const firstA = await db.action.findFirst({ where: { companyId }, orderBy: { number: "asc" } });
    const firstB = await db.action.findFirst({ where: { companyId: otherId }, orderBy: { number: "asc" } });
    expect(firstA?.number).toBe(1);
    expect(firstB?.number).toBe(1);
  });

  it("a webhook signed for one company cannot settle another company's payout", async () => {
    await runCycle(db, client, companyId, "MANUAL");
    const tx = await db.mockTransaction.findFirstOrThrow({ where: { companyId, type: "payout" } });
    const body = JSON.stringify({ event: "payout.completed", data: { transaction_id: tx.id } });
    const sig = signWebhook(body, "1", "test_secret");
    expect((await handleBlaaizWebhook(otherId, body, sig, "1")).body.message).toBe("No matching payout");
  });
});
