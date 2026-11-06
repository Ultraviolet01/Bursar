// Creating companies: blank ones from the onboarding form, and the spec's demo company.
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { addDays, isoDate } from "./dates";
import { env } from "./env";
import { audit, defaultPolicy, merchantReference } from "./repo";
import { CATEGORY_PRIORITY } from "../engine/types";

const M = (major: number) => BigInt(Math.round(major * 100));
const short = () => randomUUID().replace(/-/g, "").slice(0, 10);

export interface NewCompany {
  ownerId: string;
  name: string;
  /** Mock mode only: opening balances in major units. */
  openingNgn?: number;
  openingUsd?: number;
}

export async function createCompany(db: PrismaClient, input: NewCompany) {
  const company = await db.company.create({
    data: { ownerId: input.ownerId, name: input.name.trim(), baseCurrency: "NGN", blaaizCustomerId: env.mode === "mock" ? `mock_customer_${short()}` : null },
  });
  await db.policy.create({ data: defaultPolicy(company.id) });
  if (env.mode === "mock") {
    const opening = { NGN: input.openingNgn ?? 0, USD: input.openingUsd ?? 0 };
    for (const currency of ["NGN", "USD"] as const) {
      const id = `mock_wallet_${currency.toLowerCase()}_${short()}`;
      await db.mockWallet.create({ data: { id, companyId: company.id, currency, balance: M(opening[currency]) } });
      await db.wallet.create({ data: { companyId: company.id, blaaizWalletId: id, currency, label: `${currency} wallet`, balance: M(opening[currency]) } });
    }
  }
  await seedRateHistory(db);
  await audit(db, company.id, "OWNER", `Created ${company.name}`, "Company", company.id);
  return company;
}

/** A week of USD/NGN history so the 7-day average is meaningful from the first cycle. */
export async function seedRateHistory(db: PrismaClient) {
  if ((await db.rateSnapshot.count()) > 0) return;
  for (let h = 7 * 24; h > 0; h -= 6) {
    const rate = 1500 * (1 + 0.004 * Math.sin(h / 11));
    await db.rateSnapshot.create({ data: { pair: "USDNGN", rate: Math.round(rate * 100) / 100, fetchedAt: new Date(Date.now() - h * 3_600_000) } });
  }
}

type PayeeSeed = { key: string; name: string; category: keyof typeof CATEGORY_PRIORITY; currency: "NGN" | "USD"; bankName: string; accountNumber: string; allowlisted: boolean; critical: boolean };
type PaymentSeed = { payee: string; amount: number; due: number; recurrence: "NONE" | "MONTHLY" | "WEEKLY"; memo: string };

async function addPayeesAndPayments(db: PrismaClient, companyId: string, payees: PayeeSeed[], payments: PaymentSeed[]) {
  const today = isoDate();
  const ids: Record<string, string> = {};
  for (const p of payees) {
    const { key, ...data } = p;
    const row = await db.payee.create({
      data: { ...data, companyId, accountName: p.name, method: "bank_transfer", bankId: `mock_bank_${short()}`, verifiedAt: p.allowlisted ? new Date() : null },
    });
    ids[key] = row.id;
  }
  for (const p of payments) {
    const payee = payees.find((x) => x.key === p.payee)!;
    const dueDate = addDays(today, p.due);
    const id = `pm_${p.payee}_${short()}`;
    await db.scheduledPayment.create({
      data: {
        id,
        companyId,
        payeeId: ids[p.payee],
        amount: M(p.amount),
        amountType: "to",
        currency: payee.currency,
        dueDate,
        recurrence: p.recurrence,
        priority: CATEGORY_PRIORITY[payee.category],
        critical: payee.critical,
        memo: p.memo,
        merchantReference: merchantReference(id, dueDate),
      },
    });
  }
}

/** Section 12 of the spec: Kaduna Freight Ltd with NGN 8,000,000 and USD 1,200. */
export async function createDemoCompany(db: PrismaClient, ownerId: string, name = "Kaduna Freight Ltd") {
  const company = await createCompany(db, { ownerId, name, openingNgn: 8_000_000, openingUsd: 1_200 });
  await addPayeesAndPayments(
    db,
    company.id,
    [
      { key: "ada", name: "Ada Obi", category: "PAYROLL", currency: "NGN", bankName: "Access Bank", accountNumber: "0123456789", allowlisted: true, critical: true },
      { key: "tunde", name: "Tunde Bello", category: "PAYROLL", currency: "NGN", bankName: "GTBank", accountNumber: "0234567891", allowlisted: true, critical: true },
      { key: "zainab", name: "Zainab Yusuf", category: "PAYROLL", currency: "NGN", bankName: "Zenith Bank", accountNumber: "0345678912", allowlisted: true, critical: true },
      { key: "harbor", name: "Harbor Design Studio", category: "CRITICAL_VENDOR", currency: "USD", bankName: "Chase (US)", accountNumber: "4410023390", allowlisted: true, critical: true },
      { key: "northwind", name: "Northwind Hosting", category: "SAAS", currency: "USD", bankName: "Wells Fargo (US)", accountNumber: "7781200456", allowlisted: true, critical: false },
      { key: "webnames", name: "WebNames NG", category: "DOMAIN", currency: "NGN", bankName: "First Bank", accountNumber: "3012984471", allowlisted: true, critical: false },
      { key: "kano", name: "Kano Office Supplies", category: "VENDOR", currency: "NGN", bankName: "UBA", accountNumber: "1029384756", allowlisted: true, critical: false },
      { key: "zaria", name: "Zaria Haulage Ltd", category: "VENDOR", currency: "NGN", bankName: "Fidelity Bank", accountNumber: "5647382910", allowlisted: false, critical: false },
    ],
    [
      { payee: "ada", amount: 450_000, due: 0, recurrence: "MONTHLY", memo: "Monthly salary" },
      { payee: "tunde", amount: 600_000, due: 0, recurrence: "MONTHLY", memo: "Monthly salary" },
      { payee: "zainab", amount: 380_000, due: 0, recurrence: "MONTHLY", memo: "Monthly salary" },
      { payee: "harbor", amount: 1_500, due: 0, recurrence: "MONTHLY", memo: "Brand and UI retainer" },
      { payee: "northwind", amount: 120, due: 0, recurrence: "MONTHLY", memo: "Hosting" },
      { payee: "webnames", amount: 25_000, due: 5, recurrence: "NONE", memo: "kadunafreight.ng renewal" },
      { payee: "kano", amount: 180_000, due: 9, recurrence: "NONE", memo: "Office supplies, Q4" },
      { payee: "zaria", amount: 2_500_000, due: 0, recurrence: "NONE", memo: "Truck hire, Kaduna to Lagos" },
    ],
  );
  return company;
}

/** A smaller second company, to show one founder running two businesses. */
export async function createSecondDemoCompany(db: PrismaClient, ownerId: string) {
  const company = await createCompany(db, { ownerId, name: "Ilorin Agro Foods", openingNgn: 2_400_000, openingUsd: 300 });
  await addPayeesAndPayments(
    db,
    company.id,
    [
      { key: "bola", name: "Bola Adeyemi", category: "PAYROLL", currency: "NGN", bankName: "Wema Bank", accountNumber: "0198273645", allowlisted: true, critical: true },
      { key: "seed", name: "Kwara Seed Co", category: "CRITICAL_VENDOR", currency: "NGN", bankName: "Sterling Bank", accountNumber: "0076543219", allowlisted: true, critical: true },
      { key: "cloud", name: "Fieldbook Cloud", category: "SAAS", currency: "USD", bankName: "Chase (US)", accountNumber: "5512300981", allowlisted: true, critical: false },
    ],
    [
      { payee: "bola", amount: 320_000, due: 2, recurrence: "MONTHLY", memo: "Monthly salary" },
      { payee: "seed", amount: 900_000, due: 6, recurrence: "NONE", memo: "Maize seed, dry season" },
      { payee: "cloud", amount: 280, due: 4, recurrence: "MONTHLY", memo: "Farm records software" },
    ],
  );
  return company;
}
