// In-memory-style Blaaiz for demos and tests. State lives in the Mock* tables
// so the web app and the worker see the same balances.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { bn, CURRENCIES, type Currency, crossRate, type Rates, swapCostFor } from "../lib/money";
import { signWebhook, verifyWebhookSignature } from "./signature";
import type {
  BlaaizClient,
  CustomerRequest,
  VirtualAccount,
  FeeQuery,
  FeeQuote,
  PayoutRequest,
  PayoutResult,
  Rate,
  SwapRequest,
  SwapResult,
  Transaction,
  TxQuery,
  Wallet,
} from "./client";

export const MOCK_DEFAULTS = {
  baseRates: { NGN: 1, USD: 1500, EUR: 1620, GBP: 1890 } as Rates, // NGN per unit
  swapFeeBps: 50, // 0.5%
  payoutFee: { NGN: 5_000, USD: 100, EUR: 100, GBP: 100 } as Record<Currency, number>, // NGN 50, 1 unit otherwise
  failAccountNumber: "0000000000",
};

export type WebhookSink = (rawBody: string, signature: string, timestamp: string) => Promise<unknown>;

export interface MockOptions {
  companyId: string;
  webhookSecret: string;
  /** Delivers mock webhooks through the real handler. Null disables delivery (tests). */
  sink: WebhookSink | null;
  delays?: { processing: number; final: number };
  now?: () => Date;
}

export class MockBlaaizClient implements BlaaizClient {
  readonly mode = "mock" as const;
  constructor(private db: PrismaClient, private opts: MockOptions) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** NGN per unit with a slow, bounded drift per currency so cycles see small changes. */
  currentRates(): Rates {
    const t = this.now().getTime() / 3_600_000; // hours
    const out = { ...MOCK_DEFAULTS.baseRates };
    CURRENCIES.forEach((c, i) => {
      if (c === "NGN") return;
      const drift = 0.006 * Math.sin(t / 5 + i) + 0.002 * Math.sin(t * 1.7 + i * 2);
      out[c] = Math.round(MOCK_DEFAULTS.baseRates[c] * (1 + drift) * 100) / 100;
    });
    return out;
  }

  async listWallets(): Promise<Wallet[]> {
    const rows = await this.db.mockWallet.findMany({ where: { companyId: this.opts.companyId }, orderBy: { currency: "asc" } });
    return rows.map((w) => ({ id: w.id, currency: w.currency as Currency, balance: bn(w.balance) }));
  }

  async listRates(): Promise<Rate[]> {
    const r = this.currentRates();
    const fetchedAt = this.now();
    return CURRENCIES.filter((c) => c !== "NGN").map((c) => ({ from: c, to: "NGN" as Currency, rate: r[c], fetchedAt }));
  }

  async getFees(q: FeeQuery): Promise<FeeQuote> {
    const r = this.currentRates();
    if (q.kind === "swap") {
      const toAmount = q.toAmount ?? 0;
      const fromAmount = swapCostFor(toAmount, q.fromCurrency, q.toCurrency, r, MOCK_DEFAULTS.swapFeeBps);
      const fee = fromAmount - swapCostFor(toAmount, q.fromCurrency, q.toCurrency, r, 0);
      return { fee, total: fromAmount, rate: crossRate(q.fromCurrency, q.toCurrency, r), toAmount, fromAmount };
    }
    const amount = q.toAmount ?? q.fromAmount ?? 0;
    const fee = MOCK_DEFAULTS.payoutFee[q.fromCurrency];
    return { fee, total: amount + fee, rate: q.fromCurrency === q.toCurrency ? null : crossRate(q.fromCurrency, q.toCurrency, r), toAmount: amount, fromAmount: amount + fee };
  }

  async swap(req: SwapRequest): Promise<SwapResult> {
    const [from, to] = await Promise.all([
      this.db.mockWallet.findFirstOrThrow({ where: { id: req.fromWalletId, companyId: this.opts.companyId } }),
      this.db.mockWallet.findFirstOrThrow({ where: { id: req.toWalletId, companyId: this.opts.companyId } }),
    ]);
    const r = this.currentRates();
    const fc = from.currency as Currency;
    const tc = to.currency as Currency;
    let toAmount: number;
    let fromAmount: number;
    if (req.amountType === "to") {
      toAmount = req.amount;
      fromAmount = swapCostFor(req.amount, fc, tc, r, MOCK_DEFAULTS.swapFeeBps);
    } else {
      fromAmount = req.amount;
      const net = req.amount / (1 + MOCK_DEFAULTS.swapFeeBps / 10_000);
      toAmount = Math.floor(net / crossRate(fc, tc, r));
    }
    if (bn(from.balance) < fromAmount) throw new Error(`Mock Blaaiz: insufficient ${fc} balance for swap`);
    const id = `mock_swap_${randomUUID().slice(0, 12)}`;
    await this.db.$transaction([
      this.db.mockWallet.update({ where: { id: from.id }, data: { balance: { decrement: BigInt(fromAmount) } } }),
      this.db.mockWallet.update({ where: { id: to.id }, data: { balance: { increment: BigInt(toAmount) } } }),
      this.db.mockTransaction.create({
        data: {
          id,
          companyId: this.opts.companyId,
          type: "swap",
          status: "SUCCESSFUL",
          currency: fc,
          amount: BigInt(fromAmount),
          fee: BigInt(fromAmount - swapCostFor(toAmount, fc, tc, r, 0)),
          rate: crossRate(fc, tc, r),
          walletId: from.id,
          payload: JSON.stringify({ ...req, toAmount, fromAmount, to_currency: tc }),
        },
      }),
    ]);
    return { transactionId: id, status: "SUCCESSFUL", toAmount, fromAmount, rate: crossRate(fc, tc, r) };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    const dup = await this.db.mockTransaction.findFirst({
      where: { merchantReference: req.merchantReference, status: { not: "FAILED" } },
    });
    if (dup) throw new Error(`Mock Blaaiz: merchant_reference ${req.merchantReference} already used`);
    const wallet = await this.db.mockWallet.findFirstOrThrow({ where: { id: req.walletId, companyId: this.opts.companyId } });
    const fee = MOCK_DEFAULTS.payoutFee[req.fromCurrency];
    const total = req.toAmount + fee;
    if (bn(wallet.balance) < total) throw new Error(`Mock Blaaiz: insufficient ${req.fromCurrency} balance for payout`);
    const id = `mock_payout_${randomUUID().slice(0, 12)}`;
    await this.db.$transaction([
      this.db.mockWallet.update({ where: { id: wallet.id }, data: { balance: { decrement: BigInt(total) } } }),
      this.db.mockTransaction.create({
        data: {
          id,
          companyId: this.opts.companyId,
          type: "payout",
          status: "PENDING",
          currency: req.fromCurrency,
          amount: BigInt(req.toAmount),
          fee: BigInt(fee),
          walletId: wallet.id,
          merchantReference: req.merchantReference,
          payload: JSON.stringify(req),
        },
      }),
    ]);
    this.scheduleWebhooks(id, req);
    return { transactionId: id, status: "PENDING" };
  }

  private scheduleWebhooks(id: string, req: PayoutRequest) {
    const sink = this.opts.sink;
    if (!sink) return;
    const delays = this.opts.delays ?? { processing: 800, final: 2500 };
    const fails = req.accountNumber === MOCK_DEFAULTS.failAccountNumber;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const run = async () => {
      await sleep(delays.processing);
      await this.emit(id, "payout.processing", "PROCESSING", req).catch(() => {});
      await sleep(Math.max(0, delays.final - delays.processing));
      await this.settle(id, fails, req).catch(() => {});
    };
    // On Vercel a function is frozen once it responds; after() keeps it alive until the
    // mock webhooks are delivered. Outside a request (tests, worker), plain timers work.
    import("next/server")
      .then(({ after }) => after(run))
      .catch(() => void run());
  }

  /** Moves a pending mock payout to its final state and emits the webhook. Public for tests. */
  async settle(id: string, fails: boolean, req?: PayoutRequest) {
    const tx = await this.db.mockTransaction.findUniqueOrThrow({ where: { id } });
    if (tx.status === "SUCCESSFUL" || tx.status === "FAILED") return;
    const status = fails ? "FAILED" : "SUCCESSFUL";
    const ops = [this.db.mockTransaction.update({ where: { id }, data: { status } })];
    if (fails) ops.push(this.db.mockWallet.update({ where: { id: tx.walletId }, data: { balance: { increment: tx.amount + tx.fee } } }) as never);
    await this.db.$transaction(ops);
    await this.emit(id, fails ? "payout.failed" : "payout.completed", status, req ?? (JSON.parse(tx.payload) as PayoutRequest));
  }

  private async emit(id: string, event: string, status: string, req: PayoutRequest) {
    if (!this.opts.sink) return;
    if (status === "PROCESSING") await this.db.mockTransaction.update({ where: { id }, data: { status } });
    const body = JSON.stringify({
      event,
      data: {
        transaction_id: id,
        merchant_reference: req.merchantReference,
        status,
        amount: req.toAmount / 100,
        currency: req.toCurrency,
        ...(status === "FAILED" ? { reason: "Account number could not be credited (mock)" } : {}),
      },
    });
    const ts = Math.floor(this.now().getTime() / 1000).toString();
    await this.opts.sink(body, signWebhook(body, ts, this.opts.webhookSecret), ts);
  }

  async listTransactions(q: TxQuery): Promise<Transaction[]> {
    const typeMap: Record<string, string> = { SEND_MONEY: "payout", SWAP: "swap", FUND_WALLET: "collection" };
    const rows = await this.db.mockTransaction.findMany({
      where: {
        companyId: this.opts.companyId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: typeMap[q.type] } : {}),
        ...(q.merchantReference ? { merchantReference: q.merchantReference } : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: ((q.page ?? 1) - 1) * 50,
      take: 50,
    });
    return rows.map(toTx);
  }

  async getTransaction(id: string): Promise<Transaction> {
    return toTx(await this.db.mockTransaction.findFirstOrThrow({ where: { id, companyId: this.opts.companyId } }));
  }

  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean {
    return verifyWebhookSignature(rawBody, signature, timestamp, this.opts.webhookSecret);
  }

  async createCustomer(req: CustomerRequest): Promise<{ id: string }> {
    if (!req.email || !req.idNumber) throw new Error("Mock Blaaiz: email and ID number are required to create a customer");
    return { id: `mock_cus_${randomUUID().slice(0, 10)}` };
  }

  async createVirtualAccount(walletId: string, accountName?: string): Promise<VirtualAccount> {
    const w = await this.db.mockWallet.findFirstOrThrow({ where: { id: walletId, companyId: this.opts.companyId } });
    // Deterministic 10-digit number per wallet, so it looks stable across reloads.
    const digits = [...w.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9_000_000_000, 7) + 1_000_000_000;
    return { id: `mock_vba_${w.id}`, accountNumber: String(digits), accountName: accountName ?? "Bursar business wallet", bankName: "Blaaiz Mock Bank" };
  }

  /** Mock only: adds a wallet (live wallets are created in the Blaaiz dashboard). */
  async createWallet(currency: Currency): Promise<string> {
    const id = `mock_wallet_${currency.toLowerCase()}_${randomUUID().slice(0, 10)}`;
    await this.db.mockWallet.create({ data: { id, companyId: this.opts.companyId, currency, balance: 0n } });
    return id;
  }

  /** Simulates a dev deposit (collection.completed). Mock only. */
  async simulateDeposit(currency: Currency, amount: number) {
    const w = await this.db.mockWallet.findUniqueOrThrow({ where: { companyId_currency: { companyId: this.opts.companyId, currency } } });
    const id = `mock_collection_${randomUUID().slice(0, 12)}`;
    await this.db.$transaction([
      this.db.mockWallet.update({ where: { id: w.id }, data: { balance: { increment: BigInt(amount) } } }),
      this.db.mockTransaction.create({
        data: { id, companyId: this.opts.companyId, type: "collection", status: "SUCCESSFUL", currency, amount: BigInt(amount), fee: 0n, walletId: w.id, payload: "{}" },
      }),
    ]);
    if (this.opts.sink) {
      const body = JSON.stringify({ event: "collection.completed", data: { transaction_id: id, amount: amount / 100, currency, status: "SUCCESSFUL" } });
      const ts = Math.floor(this.now().getTime() / 1000).toString();
      await this.opts.sink(body, signWebhook(body, ts, this.opts.webhookSecret), ts);
    }
    return id;
  }
}

function toTx(t: {
  id: string; type: string; status: string; currency: string; amount: bigint; fee: bigint; rate: number | null;
  merchantReference: string | null; createdAt: Date;
}): Transaction {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    currency: t.currency,
    amount: bn(t.amount),
    fee: bn(t.fee),
    rate: t.rate,
    merchantReference: t.merchantReference,
    date: t.createdAt.toISOString(),
  };
}
