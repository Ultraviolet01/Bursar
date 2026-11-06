"use server";
// Server actions behind every dashboard button. Money only moves through the engine.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getBlaaiz } from "@/blaaiz";
import { MockBlaaizClient } from "@/blaaiz/mock";
import { signWebhook } from "@/blaaiz/signature";
import { approveAction, rejectAction, setPaused } from "@/engine/approvals";
import { runCycle } from "@/engine/cycle";
import { CATEGORY_CRITICAL_DEFAULT, CATEGORY_PRIORITY, type Category } from "@/engine/types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { toMinor } from "@/lib/money";
import { audit, merchantReference } from "@/lib/repo";
import { handleBlaaizWebhook } from "@/webhooks/handler";
import { randomUUID } from "node:crypto";

const done = () => revalidatePath("/app", "layout");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCycleAction() {
  await runCycle(db, getBlaaiz(), "MANUAL");
  done();
}

export async function approveProposal(formData: FormData) {
  const id = String(formData.get("id"));
  const out = await approveAction(db, getBlaaiz(), id);
  done();
  redirect(`/app/approvals?id=${id}${out.status === "BLOCKED" ? `&blocked=${encodeURIComponent(out.message)}` : ""}`);
}

export async function rejectProposal(formData: FormData) {
  const id = String(formData.get("id"));
  await rejectAction(db, id, String(formData.get("note") ?? "") || undefined);
  done();
  redirect(`/app/approvals?id=${id}`);
}

export async function togglePause() {
  const c = await db.company.findFirstOrThrow();
  await setPaused(db, !c.paused);
  done();
}

const money = z.string().min(1).transform((v) => toMinor(v));

export async function savePolicy(formData: FormData) {
  const f = Object.fromEntries(formData) as Record<string, string>;
  const pairs = ["NGN>USD", "USD>NGN"].filter((p) => f[`pair_${p}`] === "on");
  const data = {
    perPaymentCap: JSON.stringify({ NGN: money.parse(f.capNGN), USD: money.parse(f.capUSD) }),
    dailyCapNgn: BigInt(money.parse(f.dailyCapNgn)),
    perSwapCapNgn: BigInt(money.parse(f.perSwapCapNgn)),
    buffer: JSON.stringify({ NGN: money.parse(f.bufferNGN), USD: money.parse(f.bufferUSD) }),
    allowedPairs: pairs.join(","),
    maxRateDeviationPct: z.coerce.number().min(0).max(50).parse(f.maxRateDeviationPct),
    horizonDays: z.coerce.number().int().min(1).max(60).parse(f.horizonDays),
    maxDeferDays: z.coerce.number().int().min(0).max(30).parse(f.maxDeferDays),
    autoExecute: f.autoExecute === "on",
  };
  await db.policy.update({ where: { id: "default" }, data });
  await audit(db, "OWNER", "Updated rules", "Policy", "default");
  done();
  redirect("/app/rules?saved=1");
}

const PayeeSchema = z.object({
  name: z.string().min(2),
  category: z.enum(["PAYROLL", "CRITICAL_VENDOR", "SAAS", "DOMAIN", "VENDOR", "UTILITY"]),
  currency: z.enum(["NGN", "USD"]),
  method: z.enum(["bank_transfer", "mobile_money"]),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  phone: z.string().optional(),
});

export async function createPayee(formData: FormData) {
  const p = PayeeSchema.parse(Object.fromEntries(formData));
  const row = await db.payee.create({
    data: { ...p, bankId: p.bankName ? `mock_bank_${p.bankName.toLowerCase().replace(/\W+/g, "_")}` : null, allowlisted: false, critical: CATEGORY_CRITICAL_DEFAULT[p.category] },
  });
  await audit(db, "OWNER", `Added payee ${row.name} (not allowlisted yet)`, "Payee", row.id);
  done();
  redirect("/app/payees");
}

export async function toggleAllowlist(formData: FormData) {
  const id = String(formData.get("id"));
  const p = await db.payee.findUniqueOrThrow({ where: { id } });
  await db.payee.update({ where: { id }, data: { allowlisted: !p.allowlisted, verifiedAt: !p.allowlisted ? new Date() : p.verifiedAt } });
  await audit(db, "OWNER", `${p.allowlisted ? "Removed" : "Allowlisted"} ${p.name}`, "Payee", id);
  done();
}

export async function toggleCritical(formData: FormData) {
  const id = String(formData.get("id"));
  const p = await db.payee.findUniqueOrThrow({ where: { id } });
  await db.payee.update({ where: { id }, data: { critical: !p.critical } });
  await db.scheduledPayment.updateMany({ where: { payeeId: id, status: { in: ["SCHEDULED", "DEFERRED"] } }, data: { critical: !p.critical } });
  await audit(db, "OWNER", `Marked ${p.name} as ${p.critical ? "not critical" : "critical"}`, "Payee", id);
  done();
}

export async function createPayment(formData: FormData) {
  const f = z
    .object({ payeeId: z.string(), amount: money, dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recurrence: z.enum(["NONE", "WEEKLY", "MONTHLY"]), memo: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const payee = await db.payee.findUniqueOrThrow({ where: { id: f.payeeId } });
  const id = `pm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.scheduledPayment.create({
    data: {
      id,
      payeeId: payee.id,
      amount: BigInt(f.amount),
      currency: payee.currency,
      dueDate: f.dueDate,
      recurrence: f.recurrence,
      priority: CATEGORY_PRIORITY[payee.category as Category],
      critical: payee.critical,
      memo: f.memo || null,
      merchantReference: merchantReference(id, f.dueDate),
    },
  });
  await audit(db, "OWNER", `Scheduled ${payee.currency} ${f.amount / 100} to ${payee.name} for ${f.dueDate}`, "ScheduledPayment", id);
  done();
  redirect("/app/payments");
}

export async function cancelPayment(formData: FormData) {
  const id = String(formData.get("id"));
  const p = await db.scheduledPayment.findUniqueOrThrow({ where: { id }, include: { payee: true } });
  if (!["SCHEDULED", "DEFERRED", "PROPOSED"].includes(p.status)) return;
  await db.scheduledPayment.update({ where: { id }, data: { status: "CANCELLED" } });
  await db.action.updateMany({ where: { paymentId: id, status: "PENDING" }, data: { status: "REJECTED", decidedBy: "OWNER", decidedAt: new Date() } });
  await audit(db, "OWNER", `Cancelled payment to ${p.payee.name} due ${p.dueDate}`, "ScheduledPayment", id);
  done();
}

export async function simulateDeposit(formData: FormData) {
  const client = getBlaaiz();
  if (!(client instanceof MockBlaaizClient)) throw new Error("Deposits can only be simulated in mock mode");
  const currency = z.enum(["NGN", "USD"]).parse(formData.get("currency"));
  await client.simulateDeposit(currency, money.parse(String(formData.get("amount"))));
  done();
}

export async function sendTestWebhook() {
  const body = JSON.stringify({ event: "collection.completed", data: { transaction_id: `test_${Date.now()}`, amount: 0, currency: "NGN", status: "SUCCESSFUL", test: true } });
  const ts = Math.floor(Date.now() / 1000).toString();
  await handleBlaaizWebhook(body, signWebhook(body, ts, env.webhookSecret), ts);
  await wait(10);
  done();
  redirect("/app/settings?tested=1");
}
