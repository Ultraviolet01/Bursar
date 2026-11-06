// Stage 1. Loads balances, rates and the payment schedule; syncs local copies.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { addDays, isoDate } from "../lib/dates";
import { bn, CURRENCIES, type Currency, type Rates, toNgn } from "../lib/money";
import { getCompany, loadPolicy, toPaymentInfo } from "../lib/repo";
import type { MarketInfo, PaymentInfo, PayoutQuote, PolicyConfig, WalletState } from "./types";

export interface Observation {
  today: string;
  paused: boolean;
  policy: PolicyConfig;
  wallets: WalletState[];
  market: MarketInfo;
  payments: PaymentInfo[];
  quotes: Record<string, PayoutQuote>;
  todaySpentNgn: number;
}

export async function syncWallets(db: PrismaClient, client: BlaaizClient, companyId: string, cycleId?: string): Promise<WalletState[]> {
  const wallets = await client.listWallets();
  for (const w of wallets) {
    await db.wallet.upsert({
      where: { companyId_currency: { companyId, currency: w.currency } },
      create: { companyId, blaaizWalletId: w.id, currency: w.currency, label: `${w.currency} wallet`, balance: BigInt(w.balance) },
      update: { blaaizWalletId: w.id, balance: BigInt(w.balance) },
    });
    if (cycleId) await db.walletSnapshot.create({ data: { companyId, blaaizWalletId: w.id, currency: w.currency, balance: BigInt(w.balance), cycleId } });
  }
  return wallets.map((w) => ({ currency: w.currency, blaaizWalletId: w.id, balance: w.balance }));
}

/** Rates for every supported currency as NGN per unit, with 7-day averages. Market data is shared by all companies. */
export async function loadMarket(db: PrismaClient, client: BlaaizClient, record = true): Promise<MarketInfo> {
  const quoted = await client.listRates();
  const rates = { NGN: 1 } as Rates;
  for (const c of CURRENCIES) if (c !== "NGN") rates[c] = quoted.find((r) => r.from === c && r.to === "NGN")?.rate ?? NaN;
  if (record) {
    await db.rateSnapshot.createMany({ data: CURRENCIES.filter((c) => c !== "NGN" && Number.isFinite(rates[c])).map((c) => ({ pair: `${c}NGN`, rate: rates[c] })) });
  }
  const since = new Date(Date.now() - 7 * 86_400_000);
  const hist = await db.rateSnapshot.findMany({ where: { fetchedAt: { gte: since } }, select: { pair: true, rate: true } });
  const avg7d = { NGN: 1 } as Rates;
  for (const c of CURRENCIES) {
    if (c === "NGN") continue;
    const rows = hist.filter((h) => h.pair === `${c}NGN`);
    avg7d[c] = rows.length ? rows.reduce((s, r) => s + r.rate, 0) / rows.length : rates[c];
  }
  // Swap fee as basis points, read from a fee quote.
  const q = await client.getFees({ kind: "swap", fromCurrency: "NGN", toCurrency: "USD", toAmount: 100_00 });
  const net = q.total - q.fee;
  const swapFeeBps = net > 0 ? Math.round((q.fee / net) * 10_000) : 0;
  return { rates, avg7d, swapFeeBps };
}

export async function todaySpentNgn(db: PrismaClient, companyId: string, rates: Rates): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const execs = await db.execution.findMany({ where: { companyId, kind: "PAYOUT", createdAt: { gte: start }, status: { not: "FAILED" } } });
  return execs.reduce((s, e) => {
    const r = JSON.parse(e.request) as { fromCurrency: Currency; toAmount: number; _fee?: number };
    return s + toNgn(r.toAmount + (r._fee ?? 0), r.fromCurrency, rates);
  }, 0);
}

export async function observe(db: PrismaClient, client: BlaaizClient, companyId: string, cycleId?: string, today = isoDate()): Promise<Observation> {
  const [company, policy] = await Promise.all([getCompany(db, companyId), loadPolicy(db, companyId)]);
  const wallets = await syncWallets(db, client, companyId, cycleId);
  const market = await loadMarket(db, client, true);
  const horizonEnd = addDays(today, policy.horizonDays - 1);
  const rows = await db.scheduledPayment.findMany({
    where: { companyId, status: { in: ["SCHEDULED", "DEFERRED"] }, dueDate: { lte: horizonEnd } },
    include: { payee: true },
  });
  // Only bills in a currency this company holds a wallet for.
  const held = new Set(wallets.map((w) => w.currency));
  const payments = rows.map(toPaymentInfo).filter((p) => held.has(p.currency));
  const quotes: Record<string, PayoutQuote> = {};
  for (const p of payments) {
    const q = await client.getFees({ kind: "payout", fromCurrency: p.currency, toCurrency: p.currency, toAmount: p.amount });
    quotes[p.id] = { fee: q.fee, total: q.total };
  }
  return {
    today,
    paused: company.paused,
    policy,
    wallets,
    market,
    payments,
    quotes,
    todaySpentNgn: await todaySpentNgn(db, companyId, market.rates),
  };
}

export { bn };
