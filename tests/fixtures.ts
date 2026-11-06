import type { DecideInput } from "../src/engine/decide";
import type { Category, PaymentInfo, PolicyConfig } from "../src/engine/types";
import { CATEGORY_CRITICAL_DEFAULT, CATEGORY_PRIORITY } from "../src/engine/types";
import type { Currency } from "../src/lib/money";

export const TODAY = "2026-11-06";
export const M = (major: number) => Math.round(major * 100);

export const policy = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({
  perPaymentCap: { NGN: M(2_000_000), USD: M(1_500), EUR: M(1_400), GBP: M(1_200) },
  dailyCapNgn: M(5_000_000),
  perSwapCapNgn: M(3_000_000),
  buffer: { NGN: M(300_000), USD: M(200), EUR: M(200), GBP: M(150) },
  allowedPairs: ["NGN>USD", "USD>NGN", "NGN>EUR", "EUR>NGN", "NGN>GBP", "GBP>NGN"],
  maxRateDeviationPct: 3,
  horizonDays: 14,
  maxDeferDays: 3,
  autoExecute: true,
  ...over,
});

let n = 0;
export function payment(o: {
  name?: string;
  amount: number;
  currency?: Currency;
  category?: Category;
  due?: string;
  allowlisted?: boolean;
  critical?: boolean;
  status?: string;
}): PaymentInfo {
  const category = o.category ?? "VENDOR";
  const currency = o.currency ?? "NGN";
  const critical = o.critical ?? CATEGORY_CRITICAL_DEFAULT[category];
  const id = `p${++n}`;
  return {
    id,
    payee: { id: `payee_${id}`, name: o.name ?? id, category, currency, allowlisted: o.allowlisted ?? true, critical },
    amount: M(o.amount),
    currency,
    dueDate: o.due ?? TODAY,
    priority: CATEGORY_PRIORITY[category],
    critical,
    status: o.status ?? "SCHEDULED",
    deferCount: 0,
    merchantReference: `bursar-${id}-${o.due ?? TODAY}`,
  };
}

export const RATES = { NGN: 1, USD: 1500, EUR: 1620, GBP: 1890 };
export const market = (over: Partial<typeof RATES> = {}, avg: Partial<typeof RATES> = {}) => ({
  rates: { ...RATES, ...over },
  avg7d: { ...RATES, ...avg },
  swapFeeBps: 50,
});

export function input(over: Partial<DecideInput> & { ngn?: number; usd?: number; eur?: number; payments: PaymentInfo[] }): DecideInput {
  const fees: Record<Currency, number> = { NGN: M(50), USD: M(1), EUR: M(1), GBP: M(1) };
  return {
    today: TODAY,
    wallets: [
      { currency: "NGN", blaaizWalletId: "w_ngn", balance: M(over.ngn ?? 8_000_000) },
      { currency: "USD", blaaizWalletId: "w_usd", balance: M(over.usd ?? 1_200) },
      ...(over.eur !== undefined ? [{ currency: "EUR" as Currency, blaaizWalletId: "w_eur", balance: M(over.eur) }] : []),
    ],
    policy: policy(),
    market: market(),
    quotes: Object.fromEntries(over.payments.map((p) => [p.id, { fee: fees[p.currency], total: p.amount + fees[p.currency] }])),
    todaySpentNgn: 0,
    ...over,
  };
}
