"use server";
// Server actions behind every dashboard button. Each one resolves the signed-in
// founder's active company and only touches records that belong to it.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { forgetBlaaiz, getBlaaiz, webhookSecretFor } from "@/blaaiz";
import { MockBlaaizClient } from "@/blaaiz/mock";
import { signWebhook } from "@/blaaiz/signature";
import { approveAction, rejectAction, setPaused } from "@/engine/approvals";
import { runCycle } from "@/engine/cycle";
import { CATEGORY_CRITICAL_DEFAULT, CATEGORY_PRIORITY, type Category } from "@/engine/types";
import { destroySession, requireCompany, requireUser, setActiveCompany } from "@/lib/auth";
import { createCompany, createDemoCompany } from "@/lib/companies";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { formatMoney, toMinor } from "@/lib/money";
import { audit, merchantReference } from "@/lib/repo";
import { handleBlaaizWebhook } from "@/webhooks/handler";

const done = () => revalidatePath("/app", "layout");
const money = z.string().min(1).transform((v) => toMinor(v));

export async function runCycleAction() {
  const { company } = await requireCompany();
  try {
    const res = await runCycle(db, await getBlaaiz(company.id), company.id, "MANUAL");
    await setFlash(`Cycle finished: ${res.summary}`, res.counts.waiting ? "amber" : "good");
  } catch (e) {
    await setFlash(`Cycle failed: ${String(e).replace(/^Error: /, "")}`, "bad");
  }
  done();
}

async function ownAction(companyId: string, id: string) {
  return db.action.findFirstOrThrow({ where: { id, companyId } });
}

export async function approveProposal(formData: FormData) {
  const { company } = await requireCompany();
  const action = await ownAction(company.id, String(formData.get("id")));
  const out = await approveAction(db, await getBlaaiz(company.id), action.id);
  if (out.status === "EXECUTED") await setFlash(`Approved #${action.number}. Sent to Blaaiz.`, "good");
  else if (out.status === "BLOCKED") await setFlash(`#${action.number} was not run: ${out.message}`, "bad");
  else await setFlash(`#${action.number}: ${out.message}`, out.status === "FAILED" ? "bad" : "teal");
  done();
  redirect(`/app/approvals?id=${action.id}`);
}

export async function rejectProposal(formData: FormData) {
  const { company } = await requireCompany();
  const action = await ownAction(company.id, String(formData.get("id")));
  await rejectAction(db, action.id, String(formData.get("note") ?? "") || undefined);
  await setFlash(`Rejected #${action.number}. Nothing was paid.`, "teal");
  done();
  redirect(`/app/approvals?id=${action.id}`);
}

export async function togglePause() {
  const { company } = await requireCompany();
  await setPaused(db, company.id, !company.paused);
  await setFlash(company.paused ? "Bursar resumed." : "Bursar paused. Nothing will execute.", company.paused ? "good" : "amber");
  done();
}

export async function savePolicy(formData: FormData) {
  const { company } = await requireCompany();
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
  await db.policy.update({ where: { companyId: company.id }, data });
  await audit(db, company.id, "OWNER", "Updated rules", "Policy", company.id);
  await setFlash("Rules saved. The next cycle uses them.");
  done();
  redirect("/app/rules");
}

const PayeeSchema = z.object({
  name: z.string().trim().min(2, "Name is too short"),
  category: z.enum(["PAYROLL", "CRITICAL_VENDOR", "SAAS", "DOMAIN", "VENDOR", "UTILITY"]),
  currency: z.enum(["NGN", "USD"]),
  method: z.enum(["bank_transfer", "mobile_money"]),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  phone: z.string().optional(),
});

export async function createPayee(formData: FormData) {
  const { company } = await requireCompany();
  const p = PayeeSchema.parse(Object.fromEntries(formData));
  const row = await db.payee.create({
    data: {
      ...p,
      companyId: company.id,
      bankId: p.bankName ? `mock_bank_${p.bankName.toLowerCase().replace(/\W+/g, "_")}` : null,
      allowlisted: false,
      critical: CATEGORY_CRITICAL_DEFAULT[p.category],
    },
  });
  await audit(db, company.id, "OWNER", `Added payee ${row.name} (not allowlisted yet)`, "Payee", row.id);
  await setFlash(`Added ${row.name}. Allow them when you are ready to pay.`, "teal");
  done();
  redirect("/app/payees");
}

export async function toggleAllowlist(formData: FormData) {
  const { company } = await requireCompany();
  const p = await db.payee.findFirstOrThrow({ where: { id: String(formData.get("id")), companyId: company.id } });
  await db.payee.update({ where: { id: p.id }, data: { allowlisted: !p.allowlisted, verifiedAt: !p.allowlisted ? new Date() : p.verifiedAt } });
  await audit(db, company.id, "OWNER", `${p.allowlisted ? "Removed" : "Allowlisted"} ${p.name}`, "Payee", p.id);
  await setFlash(p.allowlisted ? `${p.name} removed from the allowlist.` : `${p.name} is allowlisted.`, p.allowlisted ? "amber" : "good");
  done();
}

export async function toggleCritical(formData: FormData) {
  const { company } = await requireCompany();
  const p = await db.payee.findFirstOrThrow({ where: { id: String(formData.get("id")), companyId: company.id } });
  await db.payee.update({ where: { id: p.id }, data: { critical: !p.critical } });
  await db.scheduledPayment.updateMany({ where: { payeeId: p.id, status: { in: ["SCHEDULED", "DEFERRED"] } }, data: { critical: !p.critical } });
  await audit(db, company.id, "OWNER", `Marked ${p.name} as ${p.critical ? "not critical" : "critical"}`, "Payee", p.id);
  await setFlash(`${p.name} is now ${p.critical ? "able to wait" : "critical"}.`, "teal");
  done();
}

export async function createPayment(formData: FormData) {
  const { company } = await requireCompany();
  const f = z
    .object({ payeeId: z.string(), amount: money, dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recurrence: z.enum(["NONE", "WEEKLY", "MONTHLY"]), memo: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const payee = await db.payee.findFirstOrThrow({ where: { id: f.payeeId, companyId: company.id } });
  const id = `pm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.scheduledPayment.create({
    data: {
      id,
      companyId: company.id,
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
  await audit(db, company.id, "OWNER", `Scheduled ${formatMoney(f.amount, payee.currency)} to ${payee.name} for ${f.dueDate}`, "ScheduledPayment", id);
  await setFlash(`Scheduled ${formatMoney(f.amount, payee.currency)} to ${payee.name}.`);
  done();
  redirect("/app/payments");
}

export async function cancelPayment(formData: FormData) {
  const { company } = await requireCompany();
  const p = await db.scheduledPayment.findFirstOrThrow({ where: { id: String(formData.get("id")), companyId: company.id }, include: { payee: true } });
  if (!["SCHEDULED", "DEFERRED", "PROPOSED"].includes(p.status)) return;
  await db.scheduledPayment.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
  await db.action.updateMany({ where: { companyId: company.id, paymentId: p.id, status: "PENDING" }, data: { status: "REJECTED", decidedBy: "OWNER", decidedAt: new Date() } });
  await audit(db, company.id, "OWNER", `Cancelled payment to ${p.payee.name} due ${p.dueDate}`, "ScheduledPayment", p.id);
  await setFlash(`Cancelled the payment to ${p.payee.name}.`, "teal");
  done();
}

export async function simulateDeposit(formData: FormData) {
  const { company } = await requireCompany();
  const client = await getBlaaiz(company.id);
  if (!(client instanceof MockBlaaizClient)) throw new Error("Deposits can only be simulated in mock mode");
  const currency = z.enum(["NGN", "USD"]).parse(formData.get("currency"));
  const amount = money.parse(String(formData.get("amount")));
  await client.simulateDeposit(currency, amount);
  await setFlash(`Deposited ${formatMoney(amount, currency)} (simulated).`);
  done();
}

export async function sendTestWebhook() {
  const { company } = await requireCompany();
  const body = JSON.stringify({ event: "collection.completed", data: { transaction_id: `test_${Date.now()}`, amount: 0, currency: "NGN", status: "SUCCESSFUL", test: true } });
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await handleBlaaizWebhook(company.id, body, signWebhook(body, ts, await webhookSecretFor(company.id)), ts);
  await setFlash(res.body.ok ? "Test webhook signed, delivered and processed." : `Test webhook failed: ${res.body.message}`, res.body.ok ? "good" : "bad");
  done();
}

export async function saveCompanySettings(formData: FormData) {
  const { company } = await requireCompany();
  const f = z
    .object({
      name: z.string().trim().min(2),
      blaaizCustomerId: z.string().trim().optional(),
      blaaizClientId: z.string().trim().optional(),
      blaaizClientSecret: z.string().optional(),
      blaaizWebhookSecret: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  const data: Record<string, string | null> = { name: f.name };
  if (f.blaaizCustomerId !== undefined) data.blaaizCustomerId = f.blaaizCustomerId || null;
  if (f.blaaizClientId !== undefined) data.blaaizClientId = f.blaaizClientId || null;
  // Secrets are write-only: blank keeps the stored value.
  if (f.blaaizClientSecret) data.blaaizClientSecretEnc = encryptSecret(f.blaaizClientSecret);
  if (f.blaaizWebhookSecret) data.blaaizWebhookSecretEnc = encryptSecret(f.blaaizWebhookSecret);
  await db.company.update({ where: { id: company.id }, data });
  forgetBlaaiz(company.id);
  await audit(db, company.id, "OWNER", "Updated company settings", "Company", company.id);
  await setFlash("Settings saved.");
  done();
  redirect("/app/settings");
}

// ---- Companies and session ----

export async function switchCompany(formData: FormData) {
  const session = await requireUser();
  const target = await db.company.findFirst({ where: { id: String(formData.get("companyId")), ownerId: session.userId } });
  if (!target) return;
  await setActiveCompany(session.id, target.id);
  await setFlash(`Switched to ${target.name}.`, "teal");
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function addCompany(formData: FormData) {
  const session = await requireUser();
  const f = z
    .object({ name: z.string().trim().min(2), openingNgn: z.coerce.number().min(0).default(0), openingUsd: z.coerce.number().min(0).default(0), demo: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const company =
    f.demo === "on"
      ? await createDemoCompany(db, session.userId, f.name)
      : await createCompany(db, { ownerId: session.userId, name: f.name, openingNgn: f.openingNgn, openingUsd: f.openingUsd });
  await setActiveCompany(session.id, company.id);
  await setFlash(`${company.name} is ready.`);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function signOut() {
  await destroySession();
  redirect("/signin");
}
