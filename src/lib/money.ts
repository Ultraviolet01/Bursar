// All money is integer minor units (kobo for NGN, cents for USD).
// NGN and USD both use 2 decimals, so converting between them is
// minor * rate, where rate = NGN per 1 USD.

export type Currency = "NGN" | "USD";
export const CURRENCIES: Currency[] = ["NGN", "USD"];

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

/** Convert minor units between NGN and USD at a mid rate (NGN per USD). */
export function convert(minor: number, from: Currency, to: Currency, usdNgn: number): number {
  if (from === to) return minor;
  if (from === "USD" && to === "NGN") return Math.round(minor * usdNgn);
  return Math.round(minor / usdNgn);
}

export function toNgn(minor: number, currency: Currency, usdNgn: number): number {
  return convert(minor, currency, "NGN", usdNgn);
}

/**
 * How much must leave `source` so exactly `toAmount` lands in `target`,
 * including a percentage swap fee in basis points. Rounds up so we never
 * under-fund.
 */
export function swapCostFor(toAmount: number, source: Currency, target: Currency, usdNgn: number, feeBps: number): number {
  const gross = source === "NGN" && target === "USD" ? toAmount * usdNgn : toAmount / usdNgn;
  return Math.ceil(gross * (1 + feeBps / 10_000));
}

export const bn = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));
