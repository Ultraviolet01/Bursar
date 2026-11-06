// Wraps blaaiz-nodejs-sdk. Every response is validated with zod; unexpected
// shapes throw a BlaaizShapeError that the cycle logs instead of crashing.
import { Blaaiz } from "blaaiz-nodejs-sdk";
import { z } from "zod";
import { CURRENCIES, isCurrency, toMinor, type Currency } from "../lib/money";
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

export class BlaaizShapeError extends Error {
  constructor(where: string, public issues: unknown) {
    super(`Unexpected Blaaiz response shape in ${where}`);
  }
}

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const minor = z.union([z.number(), z.string()]).transform((v) => toMinor(Number(v).toFixed(2)));

const WalletSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), currency: z.any(), balance: minor }).passthrough();
const FeeSchema = z
  .object({ total_fees: minor, total_amount_to_send: minor, recipient_gets: minor, exchange_rate: num.optional().nullable() })
  .passthrough();
const TxSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    type: z.string().default(""),
    status: z.string(),
    currency: z.any(),
    amount: minor.default(0),
    fee: minor.default(0),
    rate: num.nullable().optional(),
    merchant_reference: z.string().nullable().optional(),
    date: z.string().default(""),
  })
  .passthrough();

/** SDK resolves { data: <http body> }; bodies often wrap again in { data }. */
function unwrap(res: { data: unknown }): unknown {
  const body = res.data as Record<string, unknown> | undefined;
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

function parse<T extends z.ZodTypeAny>(where: string, schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new BlaaizShapeError(where, r.error.issues);
  return r.data;
}

function currencyCode(c: unknown): string {
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    return String(o.code ?? o.iso ?? o.id ?? "");
  }
  return "";
}

export interface LiveOptions {
  clientId: string;
  clientSecret: string;
  oauthScope?: string;
  baseURL: string;
  webhookSecret: string;
}

export class LiveBlaaizClient implements BlaaizClient {
  readonly mode = "live" as const;
  private sdk: Blaaiz;
  constructor(private opts: LiveOptions) {
    this.sdk = new Blaaiz({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      oauth_scope: opts.oauthScope || undefined,
      baseURL: opts.baseURL,
    });
  }

  async listWallets(): Promise<Wallet[]> {
    const rows = parse("wallets.list", z.array(WalletSchema), unwrap(await this.sdk.wallets.list()));
    return rows
      .map((w) => ({ id: w.id, currency: currencyCode(w.currency) as Currency, balance: w.balance }))
      .filter((w) => isCurrency(w.currency));
  }

  /** Returns NGN per unit for every supported currency Blaaiz quotes. Path and shape are not published. */
  async listRates(): Promise<Rate[]> {
    const raw = unwrap(await this.sdk.rates.list({}));
    const rows = Array.isArray(raw) ? raw : [];
    const found: Rate[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      const from = currencyCode(r.from_currency ?? r.from ?? r.base_currency);
      const to = currencyCode(r.to_currency ?? r.to ?? r.quote_currency);
      const rate = Number(r.rate ?? r.exchange_rate ?? r.value);
      if (isCurrency(from) && isCurrency(to) && Number.isFinite(rate) && rate > 0) found.push({ from, to, rate, fetchedAt: new Date() });
    }
    const out: Rate[] = [];
    for (const c of CURRENCIES.filter((x) => x !== "NGN")) {
      const direct = found.find((r) => r.from === c && r.to === "NGN");
      const inverse = found.find((r) => r.from === "NGN" && r.to === c);
      if (direct) out.push(direct);
      else if (inverse) out.push({ from: c, to: "NGN", rate: 1 / inverse.rate, fetchedAt: inverse.fetchedAt });
    }
    if (!out.length) throw new BlaaizShapeError("rates.list", "no NGN rates found");
    return out;
  }

  async getFees(q: FeeQuery): Promise<FeeQuote> {
    const f = parse(
      "fees.getBreakdown",
      FeeSchema,
      unwrap(
        await this.sdk.fees.getBreakdown({
          from_currency_id: q.fromCurrency,
          to_currency_id: q.toCurrency,
          from_amount: q.fromAmount != null ? q.fromAmount / 100 : (undefined as unknown as number),
          to_amount: q.toAmount != null ? q.toAmount / 100 : undefined,
        }),
      ),
    );
    return { fee: f.total_fees, total: f.total_amount_to_send, rate: f.exchange_rate ?? null, toAmount: f.recipient_gets, fromAmount: f.total_amount_to_send };
  }

  async swap(req: SwapRequest): Promise<SwapResult> {
    const raw = unwrap(
      await this.sdk.swaps.initiate({
        from_business_wallet_id: req.fromWalletId,
        to_business_wallet_id: req.toWalletId,
        amount: req.amount / 100,
        amount_type: req.amountType,
      }),
    ) as Record<string, unknown>;
    const tx = parse("swaps.initiate", TxSchema, (raw?.transaction as unknown) ?? raw);
    const details = (tx as Record<string, unknown>).swap_details as Record<string, unknown> | undefined;
    return {
      transactionId: tx.id,
      status: tx.status,
      toAmount: details?.to_amount != null ? toMinor(Number(details.to_amount).toFixed(2)) : req.amountType === "to" ? req.amount : 0,
      fromAmount: tx.amount,
      rate: tx.rate ?? null,
    };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    const res = await this.sdk.payouts.initiate({
      wallet_id: req.walletId,
      customer_id: req.customerId,
      method: req.method,
      from_currency_id: req.fromCurrency,
      to_currency_id: req.toCurrency,
      to_amount: req.toAmount / 100,
      bank_id: req.bankId ?? undefined,
      account_number: req.accountNumber ?? undefined,
      account_name: req.accountName ?? undefined,
      phone_number: req.phoneNumber ?? undefined,
      mobile_money_operator_id: req.operatorId ?? undefined,
      merchant_reference: req.merchantReference,
    } as Parameters<Blaaiz["payouts"]["initiate"]>[0]);
    const body = res.data as unknown as Record<string, unknown>;
    const tx = parse("payouts.initiate", TxSchema, body?.transaction ?? unwrap(res));
    return { transactionId: tx.id, status: tx.status };
  }

  async listTransactions(q: TxQuery): Promise<Transaction[]> {
    const raw = unwrap(
      await this.sdk.transactions.list({ page: q.page, status: q.status, type: q.type, merchant_reference: q.merchantReference }),
    );
    return parse("transactions.list", z.array(TxSchema), raw).map(mapTx);
  }

  async getTransaction(id: string): Promise<Transaction> {
    return mapTx(parse("transactions.get", TxSchema, unwrap(await this.sdk.transactions.get(id))));
  }

  async createCustomer(req: CustomerRequest): Promise<{ id: string }> {
    const raw = unwrap(
      await this.sdk.customers.create({
        first_name: req.firstName,
        last_name: req.lastName,
        business_name: req.businessName ?? undefined,
        type: req.type,
        email: req.email,
        country: req.country,
        id_type: req.idType,
        id_number: req.idNumber,
      }),
    ) as Record<string, unknown>;
    const id = raw?.id ?? (raw?.data as Record<string, unknown> | undefined)?.id;
    if (!id) throw new BlaaizShapeError("customers.create", raw);
    return { id: String(id) };
  }

  async createVirtualAccount(walletId: string, accountName?: string): Promise<VirtualAccount> {
    const v = parse(
      "virtualBankAccounts.create",
      z.object({ id: z.union([z.string(), z.number()]).transform(String), account_number: z.string(), account_name: z.string(), bank_name: z.string() }).passthrough(),
      unwrap(await this.sdk.virtualBankAccounts.create({ wallet_id: walletId, account_name: accountName })),
    );
    return { id: v.id, accountNumber: v.account_number, accountName: v.account_name, bankName: v.bank_name };
  }

  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean {
    try {
      return this.sdk.webhooks.verifySignature(rawBody, signature, timestamp, this.opts.webhookSecret);
    } catch {
      return false;
    }
  }
}

function mapTx(t: z.infer<typeof TxSchema>): Transaction {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    currency: currencyCode(t.currency),
    amount: t.amount,
    fee: t.fee,
    rate: t.rate ?? null,
    merchantReference: t.merchant_reference ?? null,
    date: t.date,
  };
}
