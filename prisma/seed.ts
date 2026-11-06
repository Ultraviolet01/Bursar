// Seeds the demo company from section 12 of the spec. Safe to re-run: wipes first.
import { PrismaClient } from "@prisma/client";
import { addDays, isoDate } from "../src/lib/dates";
import { merchantReference } from "../src/lib/repo";
import { CATEGORY_PRIORITY } from "../src/engine/types";

const db = new PrismaClient();
const M = (major: number) => BigInt(Math.round(major * 100));

async function main() {
  const today = isoDate();
  await db.$transaction([
    db.execution.deleteMany(),
    db.action.deleteMany(),
    db.cycle.deleteMany(),
    db.scheduledPayment.deleteMany(),
    db.payee.deleteMany(),
    db.walletSnapshot.deleteMany(),
    db.wallet.deleteMany(),
    db.rateSnapshot.deleteMany(),
    db.webhookEvent.deleteMany(),
    db.auditLog.deleteMany(),
    db.policy.deleteMany(),
    db.company.deleteMany(),
    db.mockTransaction.deleteMany(),
    db.mockWallet.deleteMany(),
  ]);

  await db.company.create({ data: { name: "Kaduna Freight Ltd", baseCurrency: "NGN", blaaizCustomerId: "mock_customer_kaduna" } });

  // Mock Blaaiz balances (the source of truth in mock mode) and our local copy.
  const wallets = [
    { id: "mock_wallet_ngn", currency: "NGN", balance: M(8_000_000) },
    { id: "mock_wallet_usd", currency: "USD", balance: M(1_200) },
  ];
  for (const w of wallets) {
    await db.mockWallet.create({ data: w });
    await db.wallet.create({ data: { blaaizWalletId: w.id, currency: w.currency, label: `${w.currency} wallet`, balance: w.balance } });
  }

  // A week of rate history so the 7-day average is meaningful.
  for (let h = 7 * 24; h > 0; h -= 6) {
    const rate = 1500 * (1 + 0.004 * Math.sin(h / 11));
    await db.rateSnapshot.create({ data: { pair: "USDNGN", rate: Math.round(rate * 100) / 100, fetchedAt: new Date(Date.now() - h * 3_600_000) } });
  }

  await db.policy.create({
    data: {
      id: "default",
      perPaymentCap: JSON.stringify({ NGN: Number(M(2_000_000)), USD: Number(M(1_500)) }),
      dailyCapNgn: M(5_000_000),
      perSwapCapNgn: M(3_000_000),
      buffer: JSON.stringify({ NGN: Number(M(300_000)), USD: Number(M(200)) }),
      allowedPairs: "NGN>USD,USD>NGN",
      maxRateDeviationPct: 3,
      horizonDays: 14,
      maxDeferDays: 3,
      autoExecute: true,
    },
  });

  const payees = [
    { key: "ada", name: "Ada Obi", category: "PAYROLL", currency: "NGN", bankName: "Access Bank", bankId: "mock_bank_044", accountNumber: "0123456789", allowlisted: true, critical: true },
    { key: "tunde", name: "Tunde Bello", category: "PAYROLL", currency: "NGN", bankName: "GTBank", bankId: "mock_bank_058", accountNumber: "0234567891", allowlisted: true, critical: true },
    { key: "zainab", name: "Zainab Yusuf", category: "PAYROLL", currency: "NGN", bankName: "Zenith Bank", bankId: "mock_bank_057", accountNumber: "0345678912", allowlisted: true, critical: true },
    { key: "harbor", name: "Harbor Design Studio", category: "CRITICAL_VENDOR", currency: "USD", bankName: "Chase (US)", bankId: "mock_bank_us_chase", accountNumber: "4410023390", allowlisted: true, critical: true },
    { key: "northwind", name: "Northwind Hosting", category: "SAAS", currency: "USD", bankName: "Wells Fargo (US)", bankId: "mock_bank_us_wf", accountNumber: "7781200456", allowlisted: true, critical: false },
    { key: "webnames", name: "WebNames NG", category: "DOMAIN", currency: "NGN", bankName: "First Bank", bankId: "mock_bank_011", accountNumber: "3012984471", allowlisted: true, critical: false },
    { key: "kano", name: "Kano Office Supplies", category: "VENDOR", currency: "NGN", bankName: "UBA", bankId: "mock_bank_033", accountNumber: "1029384756", allowlisted: true, critical: false },
    { key: "zaria", name: "Zaria Haulage Ltd", category: "VENDOR", currency: "NGN", bankName: "Fidelity Bank", bankId: "mock_bank_070", accountNumber: "5647382910", allowlisted: false, critical: false },
  ] as const;

  const ids: Record<string, string> = {};
  for (const p of payees) {
    const { key, ...data } = p;
    const row = await db.payee.create({ data: { ...data, accountName: p.name, method: "bank_transfer", verifiedAt: p.allowlisted ? new Date() : null } });
    ids[key] = row.id;
  }

  const payments = [
    { payee: "ada", amount: 450_000, currency: "NGN", due: 0, recurrence: "MONTHLY", memo: "November salary" },
    { payee: "tunde", amount: 600_000, currency: "NGN", due: 0, recurrence: "MONTHLY", memo: "November salary" },
    { payee: "zainab", amount: 380_000, currency: "NGN", due: 0, recurrence: "MONTHLY", memo: "November salary" },
    { payee: "harbor", amount: 1_500, currency: "USD", due: 0, recurrence: "MONTHLY", memo: "Brand and UI retainer" },
    { payee: "northwind", amount: 120, currency: "USD", due: 0, recurrence: "MONTHLY", memo: "Hosting, November" },
    { payee: "webnames", amount: 25_000, currency: "NGN", due: 5, recurrence: "NONE", memo: "kadunafreight.ng renewal" },
    { payee: "kano", amount: 180_000, currency: "NGN", due: 9, recurrence: "NONE", memo: "Office supplies, Q4" },
    { payee: "zaria", amount: 2_500_000, currency: "NGN", due: 0, recurrence: "NONE", memo: "Truck hire, Kaduna to Lagos" },
  ];
  for (const p of payments) {
    const payee = payees.find((x) => x.key === p.payee)!;
    const dueDate = addDays(today, p.due);
    const id = `pm_${p.payee}_${dueDate.replace(/-/g, "")}`;
    await db.scheduledPayment.create({
      data: {
        id,
        payeeId: ids[p.payee],
        amount: M(p.amount),
        amountType: "to",
        currency: p.currency,
        dueDate,
        recurrence: p.recurrence,
        priority: CATEGORY_PRIORITY[payee.category],
        critical: payee.critical,
        memo: p.memo,
        merchantReference: merchantReference(id, dueDate),
      },
    });
  }

  await db.auditLog.create({ data: { actor: "OWNER", message: "Seeded Kaduna Freight Ltd demo data (mock mode)." } });
  console.log(`Seeded Kaduna Freight Ltd for ${today}.`);
}

main().finally(() => db.$disconnect());
