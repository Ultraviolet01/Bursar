import type { Currency } from "../lib/money";

export type Category = "PAYROLL" | "CRITICAL_VENDOR" | "SAAS" | "DOMAIN" | "VENDOR" | "UTILITY";

export const CATEGORY_PRIORITY: Record<Category, number> = {
  PAYROLL: 1,
  CRITICAL_VENDOR: 2,
  SAAS: 3,
  DOMAIN: 3,
  VENDOR: 4,
  UTILITY: 4,
};

export const CATEGORY_CRITICAL_DEFAULT: Record<Category, boolean> = {
  PAYROLL: true,
  CRITICAL_VENDOR: true,
  SAAS: false,
  DOMAIN: false,
  VENDOR: false,
  UTILITY: false,
};

export const CATEGORY_LABEL: Record<Category, string> = {
  PAYROLL: "Payroll",
  CRITICAL_VENDOR: "Critical vendor",
  SAAS: "SaaS and hosting",
  DOMAIN: "Domain",
  VENDOR: "Vendor",
  UTILITY: "Utility",
};

export type ReasonCode =
  | "NEW_PAYEE"
  | "OVER_PAYMENT_CAP"
  | "OVER_DAILY_CAP"
  | "OVER_SWAP_CAP"
  | "SHORTFALL_CRITICAL"
  | "SHORTFALL_NON_CRITICAL"
  | "RATE_TOO_WIDE"
  | "PAIR_NOT_ALLOWED"
  | "MAX_DEFER_REACHED"
  | "PAUSED"
  | "BELOW_BUFFER_FORECAST"
  | "PAYOUT_FAILED"
  | "ROUTINE_OK";

export type ActionType = "PAY" | "SWAP" | "SWAP_THEN_PAY" | "DEFER" | "ESCALATE" | "HOLD";

export interface PolicyConfig {
  perPaymentCap: Record<Currency, number>;
  dailyCapNgn: number;
  perSwapCapNgn: number;
  buffer: Record<Currency, number>;
  allowedPairs: string[]; // "NGN>USD"
  maxRateDeviationPct: number;
  horizonDays: number;
  maxDeferDays: number;
  autoExecute: boolean;
}

export interface WalletState {
  currency: Currency;
  blaaizWalletId: string;
  balance: number;
}

export interface PayeeInfo {
  id: string;
  name: string;
  category: Category;
  currency: Currency;
  allowlisted: boolean;
  critical: boolean;
}

export interface PaymentInfo {
  id: string;
  payee: PayeeInfo;
  amount: number; // minor units, what the payee receives
  currency: Currency;
  dueDate: string;
  priority: number;
  critical: boolean;
  status: string;
  deferCount: number;
  merchantReference: string;
}

export interface MarketInfo {
  usdNgn: number; // live mid rate, NGN per USD
  usdNgnAvg7d: number;
  swapFeeBps: number;
}

/** Fee quote per payment id, from the observe stage. */
export interface PayoutQuote {
  fee: number; // minor units in payment currency
  total: number; // amount + fee, debited from the wallet
}

export interface SwapPlan {
  from: Currency;
  to: Currency;
  amountType: "to";
  toAmount: number; // lands in `to`
  fromAmount: number; // estimated debit from `from`, incl. fee
  rate: number; // NGN per USD
}

export interface ProposedAction {
  type: ActionType;
  paymentId?: string;
  reasonCode: ReasonCode;
  reasons: ReasonCode[];
  amount: number; // minor units in `currency`
  currency: Currency;
  fee: number;
  swap?: SwapPlan;
  /** For ESCALATE: what Bursar would do if the owner approves. */
  plan?: { kind: "PAY" | "SWAP_THEN_PAY"; swap?: SwapPlan };
  notes: string[];
}
