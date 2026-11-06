// Stage 1. Loads balances, rates and the payment schedule; syncs local copies.
import type { PrismaClient } from "@prisma/client";
import type { BlaaizClient } from "../blaaiz/client";
import { addDays, isoDate } from "../lib/dates";
import { bn, type Currency, toNgn } from "../lib/money";
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

export async function loadMarket(db: PrismaClient, client: BlaaizClient, record = true): Promise<MarketInfo> {
  const rates = await client.listRates();
  const usdNgn = rates.find((r) => r.from === "USD" && r.to === "NGN")!.rate;
  if (record) await db.rateSnapshot.create({ data: { pair: "USDNGN", rate: usdNgn } });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const hist = await db.rateSnapshot.findMany({ where: { pair: "USDNGN", fetchedAt: { gte: since } }, select: { rate: true } });
  const usdNgnAvg7d = hist.length ? hist.reduce((s, r) => s + r.rate, 0) / hist.length : usdNgn;
  // Swap fee as basis points, read from a fee quote.
  const q = await client.getFees({ kind: "swap", fromCurrency: "NGN", toCurrency: "USD", toAmount: 100_00 });
  const net = q.total - q.fee;
  const swapFeeBps = net > 0 ? Math.round((q.fee / net) * 10_000) : 0;
  return { usdNgn, usdNgnAvg7d, swapFeeBps };
}

export async function todaySpentNgn(db: PrismaClient, companyId: string, usdNgn: number): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const execs = await db.execution.findMany({ where: { companyId, kind: "PAYOUT", createdAt: { gte: start }, status: { not: "FAILED" } } });
  return execs.reduce((s, e) => {
    const r = JSON.parse(e.request) as { fromCurrency: Currency; toAmount: number; _fee?: number };
    return s + toNgn(r.toAmount + (r._fee ?? 0), r.fromCurrency, usdNgn);
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
  const payments = rows.map(toPaymentInfo);
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
    todaySpentNgn: await todaySpentNgn(db, companyId, market.usdNgn),
  };
}

export { bn };
