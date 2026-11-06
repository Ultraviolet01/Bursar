// Pure. For each currency: projected = balance - reserved - sum(upcoming).
import { addDays } from "../lib/dates";
import type { Currency } from "../lib/money";
import type { PolicyConfig, WalletState } from "./types";

export interface Outflow {
  id?: string;
  label?: string;
  currency: Currency;
  amount: number; // minor units debited, incl. fees where known
  dueDate: string;
}

export interface CurrencyForecast {
  currency: Currency;
  balance: number;
  buffer: number;
  reserved: number;
  upcoming: number;
  projected: number;
  available: number; // balance - buffer - reserved, today
  belowBufferOn: string | null; // first date projected balance < buffer
  series: { date: string; balance: number }[];
  steps: { date: string; label?: string; id?: string; amount: number; balanceAfter: number }[];
}

export interface ForecastInput {
  today: string;
  horizonDays: number;
  wallets: WalletState[];
  policy: Pick<PolicyConfig, "buffer">;
  outflows: Outflow[];
  reserved?: Partial<Record<Currency, number>>;
}

/** One forecast per wallet the company holds. */
export function forecast(input: ForecastInput): Partial<Record<Currency, CurrencyForecast>> {
  const end = addDays(input.today, input.horizonDays - 1);
  const out: Partial<Record<Currency, CurrencyForecast>> = {};

  for (const currency of input.wallets.map((w) => w.currency)) {
    const wallet = input.wallets.find((w) => w.currency === currency);
    const balance = wallet?.balance ?? 0;
    const buffer = input.policy.buffer[currency] ?? 0;
    const reserved = input.reserved?.[currency] ?? 0;
    const flows = input.outflows
      .filter((o) => o.currency === currency && o.dueDate <= end)
      .map((o) => ({ ...o, dueDate: o.dueDate < input.today ? input.today : o.dueDate }))
      .sort((a, b) => (a.dueDate === b.dueDate ? 0 : a.dueDate < b.dueDate ? -1 : 1));

    let running = balance - reserved;
    let belowBufferOn: string | null = running < buffer ? input.today : null;
    const steps: CurrencyForecast["steps"] = [];
    for (const f of flows) {
      running -= f.amount;
      steps.push({ date: f.dueDate, label: f.label, id: f.id, amount: f.amount, balanceAfter: running });
      if (belowBufferOn === null && running < buffer) belowBufferOn = f.dueDate;
    }

    const series: CurrencyForecast["series"] = [];
    let level = balance - reserved;
    let i = 0;
    for (let d = 0; d < input.horizonDays; d++) {
      const date = addDays(input.today, d);
      while (i < flows.length && flows[i].dueDate <= date) level -= flows[i++].amount;
      series.push({ date, balance: level });
    }

    const upcoming = flows.reduce((s, f) => s + f.amount, 0);
    out[currency] = {
      currency,
      balance,
      buffer,
      reserved,
      upcoming,
      projected: balance - reserved - upcoming,
      available: balance - buffer - reserved,
      belowBufferOn,
      series,
      steps,
    };
  }
  return out;
}
