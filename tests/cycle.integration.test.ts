// End-to-end in mock mode against a throwaway SQLite database.
import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { setBlaaiz } from "../src/blaaiz";
import { MockBlaaizClient } from "../src/blaaiz/mock";
import { runCycle } from "../src/engine/cycle";
import { approveAction, rejectAction, setPaused } from "../src/engine/approvals";
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
    // Payroll pays alone. The NGN to USD rebalance and the new vendor wait for the founder; the two USD bills are held.
    expect(first.counts).toMatchObject({ paid: 3, swapped: 0, waiting: 2, held: 2 });
    expect(await db.execution.count({ where: { companyId, kind: "SWAP" } })).toBe(0);
    const swap = await db.action.findFirstOrThrow({ where: { companyId, type: "SWAP", status: "PENDING" } });
    expect((await approveAction(db, client, swap.id)).status).toBe("EXECUTED");
    // Approving the swap runs a follow-up cycle that pays the held USD bills.
    expect((await db.cycle.findFirstOrThrow({ where: { companyId, trigger: "APPROVAL" } })).summary).toMatch(/2 paid/);
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

describe("full lifecycle", () => {
  it("rebalance waits for the owner when over the swap cap; approving it pays the held bills in a follow-up cycle", async () => {
    await db.policy.update({ where: { companyId }, data: { perSwapCapNgn: 50_000_000n } }); // NGN 500,000
    const first = await runCycle(db, client, companyId, "MANUAL");
    expect(first.counts.held).toBe(2);
    const swap = await db.action.findFirstOrThrow({ where: { companyId, type: "SWAP", status: "PENDING", reasonCode: "REBALANCE" } });
    expect(await db.action.count({ where: { companyId, type: "HOLD" } })).toBe(2);

    // A scheduled run while the swap waits must not propose it again or re-log the holds.
    await runCycle(db, client, companyId, "SCHEDULE");
    expect(await db.action.count({ where: { companyId, type: "SWAP", status: "PENDING" } })).toBe(1);
    expect(await db.action.count({ where: { companyId, type: "HOLD" } })).toBe(2);

    await db.policy.update({ where: { companyId }, data: { perSwapCapNgn: 300_000_000n } });
    const out = await approveAction(db, client, swap.id);
    expect(out.status).toBe("EXECUTED");
    const followUp = await db.cycle.findFirstOrThrow({ where: { companyId, trigger: "APPROVAL" } });
    expect(followUp.summary).toMatch(/2 paid/);
    expect(await db.scheduledPayment.count({ where: { companyId, payee: { currency: "USD" }, status: "EXECUTING" } })).toBe(2);
  });

  it("rejecting a rebalance stops it being proposed again today", async () => {
    await db.policy.update({ where: { companyId }, data: { perSwapCapNgn: 50_000_000n } });
    await runCycle(db, client, companyId, "MANUAL");
    const swap = await db.action.findFirstOrThrow({ where: { companyId, type: "SWAP", status: "PENDING" } });
    await rejectAction(db, swap.id);
    await runCycle(db, client, companyId, "MANUAL");
    expect(await db.action.count({ where: { companyId, type: "SWAP", status: "PENDING" } })).toBe(0);
    // The critical USD contractor now needs the owner instead.
    expect(await db.action.findFirst({ where: { companyId, type: "ESCALATE", status: "PENDING", paymentId: { contains: "pm_harbor" } } })).not.toBeNull();
  });

  it("previews fees and writes a ledger entry for every movement", async () => {
    await runCycle(db, client, companyId, "MANUAL");
    await approveAction(db, client, (await db.action.findFirstOrThrow({ where: { companyId, type: "SWAP", status: "PENDING" } })).id);
    const swapExec = await db.execution.findFirstOrThrow({ where: { companyId, kind: "SWAP" } });
    expect(JSON.parse(swapExec.request)._preview.fromAmount).toBeGreaterThan(0);
    const ledger = await db.ledgerEntry.findMany({ where: { companyId } });
    expect(ledger.filter((l) => l.kind === "PAYOUT")).toHaveLength(5);
    expect(ledger.filter((l) => l.kind === "FEE")).toHaveLength(5);
    expect(ledger.filter((l) => l.kind === "SWAP_OUT" && l.currency === "NGN")).toHaveLength(1);
    expect(ledger.filter((l) => l.kind === "SWAP_IN" && l.currency === "USD")).toHaveLength(1);
    // Ledger agrees with the wallet: opening USD + swap in - payouts - fees = balance.
    const usd = ledger.filter((l) => l.currency === "USD").reduce((s, l) => s + Number(l.amount), 0);
    const w = await db.mockWallet.findFirstOrThrow({ where: { companyId, currency: "USD" } });
    expect(120_000 + usd).toBe(Number(w.balance));
  });

  it("a failed payout writes a refund to the ledger", async () => {
    await db.payee.updateMany({ where: { companyId, name: "Ada Obi" }, data: { accountNumber: "0000000000" } });
    await runCycle(db, client, companyId, "MANUAL");
    const ada = await db.mockTransaction.findFirstOrThrow({ where: { companyId, merchantReference: { contains: "pm_ada" } } });
    await client.settle(ada.id, true);
    expect(await db.ledgerEntry.findFirst({ where: { companyId, kind: "REFUND", amount: 45_005_000n } })).not.toBeNull();
  });

  it("rebalances NGN into an empty EUR wallet to pay a EUR supplier and keep the EUR buffer", async () => {
    const other = mockFor(otherId);
    const res = await runCycle(db, other, otherId, "MANUAL");
    // A rebalance into EUR for the supplier due today and a top-up into USD for a bill due in 4 days: both wait for the founder.
    expect(res.counts).toMatchObject({ swapped: 0, paid: 0, waiting: 2, held: 1 });
    const rebalance = await db.action.findFirstOrThrow({ where: { companyId: otherId, type: "SWAP", reasonCode: "REBALANCE" } });
    expect(JSON.parse(rebalance.payload).currency).toBe("EUR");
    await approveAction(db, other, rebalance.id);
    expect(await db.scheduledPayment.count({ where: { companyId: otherId, payee: { currency: "EUR" }, status: "EXECUTING" } })).toBe(1);
    const eur = await db.mockWallet.findFirstOrThrow({ where: { companyId: otherId, currency: "EUR" } });
    expect(Number(eur.balance)).toBeGreaterThanOrEqual(20_000);
  });

  it("learns: after two approvals for a new payee, suggests allowlisting them; accepting applies it", async () => {
    await db.policy.update({ where: { companyId }, data: { dailyCapNgn: 10_000_000_000n, perPaymentCap: JSON.stringify({ NGN: 1_000_000_000, USD: 150_000 }) } });
    const zaria = await db.payee.findFirstOrThrow({ where: { companyId, name: "Zaria Haulage Ltd" } });
    await runCycle(db, client, companyId, "MANUAL");
    await approveAction(db, client, (await db.action.findFirstOrThrow({ where: { companyId, type: "ESCALATE", status: "PENDING" } })).id);
    // A second bill to the same payee.
    await db.scheduledPayment.create({
      data: { id: "pm_zaria_2", companyId, payeeId: zaria.id, amount: 10_000_000n, currency: "NGN", dueDate: new Date().toISOString().slice(0, 10), priority: 4, critical: false, merchantReference: "bursar-pm_zaria_2-x" },
    });
    await runCycle(db, client, companyId, "MANUAL");
    await approveAction(db, client, (await db.action.findFirstOrThrow({ where: { companyId, type: "ESCALATE", status: "PENDING" } })).id);
    const res = await runCycle(db, client, companyId, "MANUAL");
    expect(res.counts.learned).toBe(1);
    const suggestion = await db.action.findFirstOrThrow({ where: { companyId, type: "RULE_CHANGE", status: "PENDING" } });
    expect(suggestion.explanation).toMatch(/Zaria Haulage Ltd 2 times/);
    await approveAction(db, client, suggestion.id);
    expect((await db.payee.findUniqueOrThrow({ where: { id: zaria.id } })).allowlisted).toBe(true);
    // Not suggested twice.
    expect((await runCycle(db, client, companyId, "MANUAL")).counts.learned).toBe(0);
  });

  it("a deposit webhook triggers a cycle (event-driven cadence)", async () => {
    await client.simulateDeposit("NGN", 100_000_00);
    for (let i = 0; i < 50 && !(await db.cycle.findFirst({ where: { companyId, trigger: "WEBHOOK", finishedAt: { not: null } } })); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await db.cycle.findFirst({ where: { companyId, trigger: "WEBHOOK" } })).not.toBeNull();
    expect(await db.ledgerEntry.findFirst({ where: { companyId, kind: "DEPOSIT" } })).not.toBeNull();
  });
});
