// All money is integer minor units (kobo, cents, pence). Every supported currency
// has 2 decimals, so converting is minor * rate. Rates are NGN per 1 unit of a
// currency (NGN itself is 1), which gives every cross rate from one table.

export type Currency = "NGN" | "USD" | "EUR" | "GBP";
export const CURRENCIES: Currency[] = ["NGN", "USD", "EUR", "GBP"];
export const CURRENCY_NAME: Record<Currency, string> = { NGN: "Naira", USD: "US dollar", EUR: "Euro", GBP: "Pound sterling" };

/** NGN per 1 unit of each currency. */
export type Rates = Record<Currency, number>;

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as string[]).includes(v);
}

export function parseCurrencies(list: string | null | undefined): Currency[] {
  const out = (list ?? "NGN").split(",").map((s) => s.trim()).filter(isCurrency);
  return CURRENCIES.filter((c) => out.includes(c) || c === "NGN");
}

export function toMinor(major: number | string): number {
  const s = typeof major === "number" ? major.toFixed(2) : major.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${major}`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const v = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -v : v;
}

export function formatMinor(minor: number, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}${decimals ? "." + frac : ""}`;
}

export function formatMoney(minor: number, currency: Currency | string, opts: { decimals?: boolean } = {}): string {
  return `${currency} ${formatMinor(minor, opts)}`;
}

/** Convert minor units between currencies at mid rates. */
export function convert(minor: number, from: Currency, to: Currency, rates: Rates): number {
  if (from === to) return minor;
  return Math.round((minor * rates[from]) / rates[to]);
}

export function toNgn(minor: number, currency: Currency, rates: Rates): number {
  return Math.round(minor * rates[currency]);
}

/** Units of `source` paid for 1 unit of `target`. */
export function crossRate(source: Currency, target: Currency, rates: Rates): number {
  return rates[target] / rates[source];
}

/**
 * How much must leave `source` so exactly `toAmount` lands in `target`,
 * including a percentage swap fee in basis points. Rounds up so we never
 * under-fund.
 */
export function swapCostFor(toAmount: number, source: Currency, target: Currency, rates: Rates, feeBps: number): number {
  return Math.ceil(toAmount * crossRate(source, target, rates) * (1 + feeBps / 10_000));
}

export function formatRate(source: Currency, target: Currency, rates: Rates): string {
  const r = crossRate(source, target, rates);
  return r >= 1 ? `${r.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${source} per ${target}` : `${(1 / r).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${target} per ${source}`;
}

export const bn = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));
