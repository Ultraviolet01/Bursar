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
import { runCycle, triggerCycle } from "@/engine/cycle";
import { executeAction } from "@/engine/execute";
import { loadMarket } from "@/engine/observe";
import type { ProposedAction } from "@/engine/types";
import { CATEGORY_CRITICAL_DEFAULT, CATEGORY_PRIORITY, type Category } from "@/engine/types";
import { destroySession, requireCompany, requireUser, setActiveCompany } from "@/lib/auth";
import { createCompany, createDemoCompany } from "@/lib/companies";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { CURRENCIES, type Currency, crossRate, formatMoney, isCurrency, parseCurrencies, swapCostFor, toMinor } from "@/lib/money";
import { audit, loadPolicy, merchantReference, nextActionNumber } from "@/lib/repo";
import { env } from "@/lib/env";
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
  const current = await loadPolicy(db, company.id);
  const pairs = CURRENCIES.flatMap((a) => CURRENCIES.map((b) => `${a}>${b}`)).filter((p) => f[`pair_${p}`] === "on");
  const caps = { ...current.perPaymentCap };
  const buffers = { ...current.buffer };
  for (const c of CURRENCIES) {
    if (f[`cap${c}`]) caps[c] = money.parse(f[`cap${c}`]);
    if (f[`buffer${c}`]) buffers[c] = money.parse(f[`buffer${c}`]);
  }
  const data = {
    perPaymentCap: JSON.stringify(caps),
    dailyCapNgn: BigInt(money.parse(f.dailyCapNgn)),
    perSwapCapNgn: BigInt(money.parse(f.perSwapCapNgn)),
    buffer: JSON.stringify(buffers),
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
  currency: z.enum(["NGN", "USD", "EUR", "GBP"]),
  method: z.enum(["bank_transfer", "mobile_money"]),
  email: z.string().trim().optional(),
  country: z.string().trim().max(2).optional(),
  idType: z.enum(["", "drivers_license", "passport", "id_card", "resident_permit", "certificate_of_incorporation"]).optional(),
  idNumber: z.string().trim().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  phone: z.string().optional(),
});

export async function createPayee(formData: FormData) {
  const { company } = await requireCompany();
  const p = PayeeSchema.parse(Object.fromEntries(formData));
  if (!parseCurrencies(company.currencies).includes(p.currency)) throw new Error(`${company.name} has no ${p.currency} wallet. Add one in Wallets first.`);
  const row = await db.payee.create({
    data: {
      ...p,
      email: p.email || null,
      country: p.country ? p.country.toUpperCase() : null,
      idType: p.idType || null,
      idNumber: p.idNumber || null,
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
  let extra = "";
  // Setup: allowlisting also registers the payee with Blaaiz when their details are complete.
  if (!p.allowlisted && !p.blaaizCustomerId && p.email && p.country && p.idType && p.idNumber) {
    const ok = await registerPayee(company.id, p.id).catch(() => false);
    extra = ok ? " Registered with Blaaiz." : " Could not register with Blaaiz yet.";
  }
  await setFlash(p.allowlisted ? `${p.name} removed from the allowlist.` : `${p.name} is allowlisted.${extra}`, p.allowlisted ? "amber" : "good");
  done();
}

async function registerPayee(companyId: string, payeeId: string): Promise<boolean> {
  const p = await db.payee.findFirstOrThrow({ where: { id: payeeId, companyId } });
  if (p.blaaizCustomerId) return true;
  if (!p.email || !p.country || !p.idType || !p.idNumber) return false;
  const business = p.category !== "PAYROLL";
  const [first, ...rest] = p.name.split(" ");
  const res = await (await getBlaaiz(companyId)).createCustomer({
    firstName: business ? p.name : first,
    lastName: business ? "Ltd" : rest.join(" ") || first,
    businessName: business ? p.name : null,
    type: business ? "business" : "individual",
    email: p.email,
    country: p.country,
    idType: p.idType as "id_card",
    idNumber: p.idNumber,
  });
  await db.payee.update({ where: { id: p.id }, data: { blaaizCustomerId: res.id } });
  await audit(db, companyId, "OWNER", `Registered ${p.name} as a Blaaiz customer (${res.id})`, "Payee", p.id);
  return true;
}

export async function registerPayeeAction(formData: FormData) {
  const { company } = await requireCompany();
  const p = await db.payee.findFirstOrThrow({ where: { id: String(formData.get("id")), companyId: company.id } });
  try {
    const ok = await registerPayee(company.id, p.id);
    await setFlash(ok ? `${p.name} is a Blaaiz customer.` : `Add ${p.name}'s email, country and ID first.`, ok ? "good" : "amber");
  } catch (e) {
    await setFlash(`Blaaiz did not register ${p.name}: ${String(e).replace(/^Error: /, "")}`, "bad");
  }
  done();
}

export async function savePayeeKyc(formData: FormData) {
  const { company } = await requireCompany();
  const f = z
    .object({ id: z.string(), email: z.string().trim().email(), country: z.string().trim().length(2), idType: z.enum(["drivers_license", "passport", "id_card", "resident_permit", "certificate_of_incorporation"]), idNumber: z.string().trim().min(3) })
    .parse(Object.fromEntries(formData));
  const p = await db.payee.findFirstOrThrow({ where: { id: f.id, companyId: company.id } });
  await db.payee.update({ where: { id: p.id }, data: { email: f.email, country: f.country.toUpperCase(), idType: f.idType, idNumber: f.idNumber } });
  const ok = await registerPayee(company.id, p.id).catch(() => false);
  await setFlash(ok ? `${p.name} saved and registered with Blaaiz.` : `${p.name} saved. Registration with Blaaiz failed; try again.`, ok ? "good" : "amber");
  done();
}

// ---- Wallet setup: add, fund, convert ----

export async function addWallet(formData: FormData) {
  const { company } = await requireCompany();
  const currency = z.enum(["USD", "EUR", "GBP"]).parse(formData.get("currency"));
  const held = parseCurrencies(company.currencies);
  if (held.includes(currency)) return;
  const client = await getBlaaiz(company.id);
  if (!(client instanceof MockBlaaizClient)) {
    await setFlash(`Create the ${currency} wallet in your Blaaiz dashboard. Bursar picks it up on the next cycle.`, "teal");
    done();
    return;
  }
  const id = await client.createWallet(currency);
  await db.wallet.create({ data: { companyId: company.id, blaaizWalletId: id, currency, label: `${currency} wallet`, balance: 0n } });
  await db.company.update({ where: { id: company.id }, data: { currencies: [...held, currency].join(",") } });
  await audit(db, company.id, "OWNER", `Added a ${currency} wallet`, "Wallet", id);
  await setFlash(`${currency} wallet added. Fund it by converting from NGN.`);
  done();
  redirect(`/app/wallets?c=${currency}`);
}

export async function createVirtualAccountAction(formData: FormData) {
  const { company } = await requireCompany();
  const currency = isCurrency(formData.get("currency")) ? (formData.get("currency") as Currency) : "NGN";
  const wallet = await db.wallet.findUniqueOrThrow({ where: { companyId_currency: { companyId: company.id, currency } } });
  try {
    const va = await (await getBlaaiz(company.id)).createVirtualAccount(wallet.blaaizWalletId, company.name);
    await db.wallet.update({ where: { id: wallet.id }, data: { vaAccountNumber: va.accountNumber, vaAccountName: va.accountName, vaBankName: va.bankName } });
    await audit(db, company.id, "OWNER", `Created a virtual account for the ${currency} wallet (${va.bankName} ${va.accountNumber})`, "Wallet", wallet.id);
    await setFlash(`Bank account ready: ${va.bankName} ${va.accountNumber}.`);
  } catch (e) {
    await setFlash(`Blaaiz did not create the account: ${String(e).replace(/^Error: /, "")}`, "bad");
  }
  done();
}

/** Owner-initiated swap between the company's own wallets. Still previewed and policy-checked. */
export async function convertCurrency(formData: FormData) {
  const { company } = await requireCompany();
  const f = z.object({ from: z.enum(["NGN", "USD", "EUR", "GBP"]), to: z.enum(["NGN", "USD", "EUR", "GBP"]), amount: money }).parse(Object.fromEntries(formData));
  if (f.from === f.to) throw new Error("Pick two different wallets");
  const client = await getBlaaiz(company.id);
  const market = await loadMarket(db, client, false);
  const proposal: ProposedAction = {
    type: "SWAP",
    reasonCode: "REBALANCE",
    reasons: ["REBALANCE"],
    amount: f.amount,
    currency: f.to,
    fee: 0,
    swap: { from: f.from, to: f.to, amountType: "to", toAmount: f.amount, fromAmount: swapCostFor(f.amount, f.from, f.to, market.rates, market.swapFeeBps), rate: crossRate(f.from, f.to, market.rates) },
    notes: ["Started by you from Wallets"],
  };
  const row = await db.action.create({
    data: {
      companyId: company.id,
      number: await nextActionNumber(db, company.id),
      type: "SWAP",
      payload: JSON.stringify(proposal),
      reasonCode: "REBALANCE",
      explanation: `You converted ${f.from} into ${formatMoney(f.amount, f.to)}.`,
      policyResult: JSON.stringify({ checks: [], autoOk: false, ownerOk: true }),
      status: "PENDING",
    },
  });
  const out = await executeAction(db, client, row.id, { ownerApproved: true });
  if (out.status === "EXECUTED") {
    await db.action.update({ where: { id: row.id }, data: { decidedBy: "OWNER", decidedAt: new Date() } });
    await setFlash(`Converted into ${formatMoney(f.amount, f.to)}.`);
    void triggerCycle(company.id, "APPROVAL");
  } else {
    await db.action.update({ where: { id: row.id }, data: { status: "REJECTED", decidedBy: "OWNER", decidedAt: new Date(), explanation: `Conversion not run: ${out.message}` } });
    await setFlash(`Not converted: ${out.message}`, "bad");
  }
  done();
  redirect(`/app/wallets?c=${f.to}`);
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
  // Event-driven cadence: a new bill runs a cycle straight away.
  const res = await triggerCycle(company.id, "BILL");
  await setFlash(`Scheduled ${formatMoney(f.amount, payee.currency)} to ${payee.name}.${res ? ` Cycle ran: ${res.summary}` : ""}`);
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
  const currency = z.enum(["NGN", "USD", "EUR", "GBP"]).parse(formData.get("currency"));
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
    .object({ name: z.string().trim().min(2), demo: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const currencies = CURRENCIES.filter((c) => c === "NGN" || formData.get(`cur_${c}`) === "on");
  const opening = Object.fromEntries(currencies.map((c) => [c, Number(formData.get(`opening_${c}`) ?? 0) || 0]));
  const company =
    f.demo === "on"
      ? await createDemoCompany(db, session.userId, f.name)
      : await createCompany(db, { ownerId: session.userId, name: f.name, currencies, opening });
  await setActiveCompany(session.id, company.id);
  await setFlash(`${company.name} is ready.`);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function signOut() {
  await destroySession();
  redirect("/signin");
}

// ---- Account ----

export async function resendVerification() {
  const session = await requireUser();
  if (session.user.emailVerifiedAt) return;
  const { sendVerification } = await import("../(auth)/actions");
  try {
    await sendVerification(session.user.id, session.user.email, session.user.name);
    await setFlash(`Confirmation link sent to ${session.user.email}.`, "teal");
  } catch (e) {
    await setFlash(String(e).replace(/^Error: /, ""), "amber");
  }
  revalidatePath("/app", "layout");
}

export async function saveAccount(formData: FormData) {
  const session = await requireUser();
  const name = z.string().trim().min(2).parse(formData.get("name"));
  await db.user.update({ where: { id: session.userId }, data: { name } });
  await setFlash("Name saved.");
  revalidatePath("/app", "layout");
}

export async function changePassword(formData: FormData) {
  const session = await requireUser();
  const { verifyPassword, hashPassword } = await import("@/lib/crypto");
  const next = String(formData.get("newPassword") ?? "");
  if (next.length < 8) {
    await setFlash("Use at least 8 characters for your password.", "bad");
    return revalidatePath("/app", "layout");
  }
  if (session.user.passwordHash && !verifyPassword(String(formData.get("currentPassword") ?? ""), session.user.passwordHash)) {
    await setFlash("Your current password is not right.", "bad");
    return revalidatePath("/app", "layout");
  }
  await db.user.update({ where: { id: session.userId }, data: { passwordHash: hashPassword(next) } });
  // Keep this device signed in; sign out the others.
  await db.session.deleteMany({ where: { userId: session.userId, id: { not: session.id } } });
  await setFlash(session.user.passwordHash ? "Password changed. Other devices were signed out." : "Password set. You can now sign in with it too.");
  revalidatePath("/app", "layout");
}
