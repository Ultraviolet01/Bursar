// Read models for the dashboard. Server-only.
import { db } from "./db";
import { env } from "./env";
import { bn, CURRENCIES, type Currency, type Rates, toNgn } from "./money";
import { isoDate } from "./dates";
import { loadPolicy, toPaymentInfo } from "./repo";
import { forecast, type CurrencyForecast } from "../engine/forecast";
import { MOCK_DEFAULTS } from "../blaaiz/mock";

/** Latest rate per currency (NGN per unit) and its 7-day average, from snapshots. */
export async function getRates(): Promise<{ rates: Rates; avg7d: Rates }> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db.rateSnapshot.findMany({ where: { fetchedAt: { gte: since } }, orderBy: { fetchedAt: "desc" } });
  const rates = { ...MOCK_DEFAULTS.baseRates };
  const avg7d = { ...MOCK_DEFAULTS.baseRates };
  for (const c of CURRENCIES) {
    if (c === "NGN") continue;
    const mine = rows.filter((r) => r.pair === `${c}NGN`);
    if (mine.length) {
      rates[c] = mine[0].rate;
      avg7d[c] = mine.reduce((s, r) => s + r.rate, 0) / mine.length;
    }
  }
  return { rates, avg7d };
}

export async function getShell(companyId: string) {
  const [company, pending, lastCycle] = await Promise.all([
    db.company.findUnique({ where: { id: companyId } }),
    db.action.count({ where: { companyId, status: "PENDING" } }),
    db.cycle.findFirst({ where: { companyId }, orderBy: { startedAt: "desc" } }),
  ]);
  return { company, pending, lastCycle, mode: env.mode };
}

export async function getTreasury(companyId: string) {
  const today = isoDate();
  const policy = await loadPolicy(db, companyId);
  const [wallets, payments, { rates, avg7d }] = await Promise.all([
    db.wallet.findMany({ where: { companyId }, orderBy: { currency: "asc" } }),
    db.scheduledPayment.findMany({
      where: { companyId, status: { in: ["SCHEDULED", "DEFERRED", "PROPOSED"] } },
      include: { payee: true },
      orderBy: [{ dueDate: "asc" }, { priority: "asc" }],
    }),
    getRates(),
  ]);
  const fee = MOCK_DEFAULTS.payoutFee; // estimate for the forecast view; cycles use live quotes
  const outflows = payments.map((p) => ({
    id: p.id,
    label: p.payee.name,
    currency: p.currency as Currency,
    amount: bn(p.amount) + (fee[p.currency as Currency] ?? 0),
    dueDate: p.dueDate,
  }));
  // Wallets in the order NGN, USD, EUR, GBP.
  const currencies = CURRENCIES.filter((c) => wallets.some((w) => w.currency === c));
  const walletStates = currencies.map((c) => {
    const w = wallets.find((x) => x.currency === c)!;
    return { currency: c, blaaizWalletId: w.blaaizWalletId, balance: bn(w.balance) };
  });
  const partial = forecast({ today, horizonDays: policy.horizonDays, wallets: walletStates, policy, outflows });
  const fc = partial as Record<Currency, CurrencyForecast>;

  // Combined NGN-equivalent series for the overview chart.
  const days = currencies.length ? fc[currencies[0]].series.length : 0;
  const totalSeries = Array.from({ length: days }, (_, i) => ({
    date: fc[currencies[0]].series[i].date,
    value: currencies.reduce((s, c) => s + toNgn(fc[c].series[i].balance, c, rates), 0),
  }));
  const totalNgn = currencies.reduce((s, c) => s + toNgn(fc[c].balance, c, rates), 0);
  const bufferNgn = currencies.reduce((s, c) => s + toNgn(policy.buffer[c] ?? 0, c, rates), 0);

  return { today, policy, wallets, currencies, payments: payments.map((p) => ({ ...toPaymentInfo(p), row: p })), fc, totalSeries, totalNgn, bufferNgn, rates, avg7d };
}

export function walletHealth(f: CurrencyForecast): { label: string; tone: "good" | "amber" | "bad" | "teal" } {
  if (f.balance === 0) return { label: "Empty", tone: "amber" };
  if (f.balance < f.buffer) return { label: "Below buffer", tone: "bad" };
  if (f.belowBufferOn) return { label: `Short ${(Math.max(0, f.buffer - f.projected) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, tone: "amber" };
  return { label: "Healthy", tone: "good" };
}

export function runwayDays(f: CurrencyForecast, today: string, horizon: number): string {
  if (!f.belowBufferOn) return `covered for ${horizon} days`;
  const days = Math.max(0, Math.round((new Date(f.belowBufferOn).getTime() - new Date(today).getTime()) / 86_400_000));
  return days === 0 ? "below buffer today" : `covered for ${days} days`;
}
