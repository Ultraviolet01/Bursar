// Read models for the dashboard. Server-only.
import { db } from "./db";
import { env } from "./env";
import { bn, CURRENCIES, type Currency, toNgn } from "./money";
import { isoDate } from "./dates";
import { loadPolicy, toPaymentInfo } from "./repo";
import { forecast, type CurrencyForecast } from "../engine/forecast";
import { MOCK_DEFAULTS } from "../blaaiz/mock";

export async function getShell() {
  const [company, pending, lastCycle, lastRate] = await Promise.all([
    db.company.findFirst(),
    db.action.count({ where: { status: "PENDING" } }),
    db.cycle.findFirst({ orderBy: { startedAt: "desc" } }),
    db.rateSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
  ]);
  return { company, pending, lastCycle, mode: env.mode, usdNgn: lastRate?.rate ?? MOCK_DEFAULTS.baseUsdNgn };
}

export async function getTreasury() {
  const today = isoDate();
  const policy = await loadPolicy(db);
  const [wallets, payments, rate] = await Promise.all([
    db.wallet.findMany({ orderBy: { currency: "asc" } }),
    db.scheduledPayment.findMany({
      where: { status: { in: ["SCHEDULED", "DEFERRED", "PROPOSED"] } },
      include: { payee: true },
      orderBy: [{ dueDate: "asc" }, { priority: "asc" }],
    }),
    db.rateSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
  ]);
  const usdNgn = rate?.rate ?? MOCK_DEFAULTS.baseUsdNgn;
  const fee = MOCK_DEFAULTS.payoutFee; // estimate for the forecast view; cycles use live quotes
  const outflows = payments.map((p) => ({
    id: p.id,
    label: p.payee.name,
    currency: p.currency as Currency,
    amount: bn(p.amount) + fee[p.currency as Currency],
    dueDate: p.dueDate,
  }));
  const walletStates = wallets.map((w) => ({ currency: w.currency as Currency, blaaizWalletId: w.blaaizWalletId, balance: bn(w.balance) }));
  const fc = forecast({ today, horizonDays: policy.horizonDays, wallets: walletStates, policy, outflows });

  // Combined NGN-equivalent series for the overview chart.
  const totalSeries = fc.NGN.series.map((pt, i) => ({
    date: pt.date,
    value: CURRENCIES.reduce((s, c) => s + toNgn(fc[c].series[i].balance, c, usdNgn), 0),
  }));
  const totalNgn = CURRENCIES.reduce((s, c) => s + toNgn(fc[c].balance, c, usdNgn), 0);
  const bufferNgn = CURRENCIES.reduce((s, c) => s + toNgn(policy.buffer[c], c, usdNgn), 0);

  return { today, policy, wallets, payments: payments.map((p) => ({ ...toPaymentInfo(p), row: p })), fc, totalSeries, totalNgn, bufferNgn, usdNgn };
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
