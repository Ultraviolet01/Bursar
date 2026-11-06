// Our contract with Blaaiz. Mock and live clients implement it.
// Nothing outside src/blaaiz/ imports the SDK. All amounts are minor units.
import type { Currency } from "../lib/money";

export type BlaaizMode = "mock" | "live";

export interface Wallet {
  id: string;
  currency: Currency;
  balance: number;
}

export interface Rate {
  from: Currency;
  to: Currency;
  rate: number; // units of `to` per 1 `from`
  fetchedAt: Date;
}

export interface FeeQuery {
  kind: "payout" | "swap";
  fromCurrency: Currency;
  toCurrency: Currency;
  fromAmount?: number;
  toAmount?: number;
}

export interface FeeQuote {
  fee: number; // in fromCurrency
  total: number; // debited from the source wallet, fees included
  rate: number | null;
  toAmount: number;
  fromAmount: number;
}

export interface SwapRequest {
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  amountType: "from" | "to";
}

export interface SwapResult {
  transactionId: string;
  status: string;
  toAmount: number;
  fromAmount: number;
  rate: number | null;
}

export interface PayoutRequest {
  walletId: string;
  customerId: string;
  method: "bank_transfer" | "mobile_money";
  fromCurrency: Currency;
  toCurrency: Currency;
  toAmount: number;
  bankId?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  phoneNumber?: string | null;
  operatorId?: string | null;
  merchantReference: string;
}

export interface PayoutResult {
  transactionId: string;
  status: string;
}

export interface TxQuery {
  page?: number;
  status?: "FAILED" | "SUCCESSFUL" | "EXPIRED";
  type?: "SEND_MONEY" | "FUND_WALLET" | "SWAP";
  merchantReference?: string;
}

export interface Transaction {
  id: string;
  type: string;
  status: string; // PENDING | PROCESSING | SUCCESSFUL | FAILED | ...
  currency: string;
  amount: number;
  fee: number;
  rate: number | null;
  merchantReference: string | null;
  date: string;
}

export interface BlaaizClient {
  readonly mode: BlaaizMode;
  listWallets(): Promise<Wallet[]>;
  listRates(): Promise<Rate[]>;
  getFees(q: FeeQuery): Promise<FeeQuote>;
  swap(req: SwapRequest): Promise<SwapResult>;
  payout(req: PayoutRequest): Promise<PayoutResult>;
  listTransactions(q: TxQuery): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction>;
  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean;
}
