# Going live with Blaaiz

What to do when Blaaiz API keys arrive. Bursar's engine is the same in mock and live mode; only the client changes (`src/blaaiz/live.ts`).

## 1. Get the keys (Blaaiz dev dashboard, https://business-dev.blaaiz.com)

- **API & Webhooks:** create OAuth credentials and copy the `client_id` and the `client_secret`. The secret is shown once.
- **Webhooks:** copy the webhook `signing_secret`.
- **Customers:** the business's own verified customer ID. Payouts are sent on its behalf as `customer_id`.
- The development sandbox only settles NGN deposits, and GBP and EUR wallets are on hold there. Test with NGN and USD.

## 2. Check the connection before switching

Put the keys in `.env`, then run:

```bash
npm run blaaiz:check
```

It makes read-only calls only and never pays or swaps:
- OAuth token
- wallets
- rates
- fee preview
- currencies
- banks
- webhook settings
- transactions

For each call it prints whether it passed and the field names Blaaiz returned. If a call fails or its field names differ from the parsers in `src/blaaiz/live.ts`, adjust that one parser (listed below) and run the check again.

## 3. Switch Bursar to live

Locally, in `.env` (on Vercel, under Project, Settings, Environment Variables):

```
BLAAIZ_MODE=live
BLAAIZ_API_URL=https://api-dev.blaaiz.com
BURSAR_SECRET_KEY=<32+ random characters>   # encrypts each company's Blaaiz secrets
APP_URL=https://bursar-beta.vercel.app      # public https address, used to register webhooks
```

Then add a company, or open **Settings, Run Blaaiz setup again** for an existing one, and enter that business's keys. Bursar then does the setup itself:

1. **Finds the wallets.** It lists the business's wallets and keeps NGN, USD, EUR and GBP. Blaaiz creates wallets with the business account; its API has no endpoint to create them.
2. **Reads rates**, so forecasts and swaps have prices straight away.
3. **Creates the NGN funding account** with `virtualBankAccounts.create`.
4. **Registers the webhook** `https://<APP_URL>/api/webhooks/blaaiz/<companyId>` with `webhooks.register`, or updates it if one exists.

**Settings, Test Blaaiz connection** runs the same checks as `npm run blaaiz:check` for that company.

## 4. First live money (small amounts)

1. Fund NGN by bank transfer to the funding account shown on **Wallets**. The deposit webhook updates the balance and starts a cycle.
2. Schedule a small NGN payout to an allowlisted payee, then **Run cycle**.
   - Watch for `payout.processing`, then `payout.completed`, in **Activity, System log**.
3. Convert a small NGN amount into USD on **Wallets**. Check the ledger and the Blaaiz dashboard agree.
4. Run the cycle again and confirm nothing pays twice. Each payout carries `merchant_reference = bursar-{paymentId}-{dueDate}`.

## Parsers to confirm against real responses

These fields are not in the Blaaiz docs, so `src/blaaiz/live.ts` parses them defensively. A wrong shape makes a cycle fail with a clear error instead of moving money.

| Call | What Bursar assumes | Where |
|------|---------------------|-------|
| `wallets.list` | rows with `id`, `currency` (code or object), `balance` in major units | `WalletSchema`, `listWallets` |
| `rates.list` | rows with `from_currency`/`to_currency` (or `from`/`to`) and `rate` | `listRates` |
| `fees.getBreakdown` | `total_fees`, `total_amount_to_send`, `recipient_gets`, `exchange_rate` | `FeeSchema` |
| `swaps.initiate` | a transaction with `id`, `status`, `amount`, `swap_details.to_amount` | `swap` |
| `payouts.initiate` | `{ transaction: { id, status } }` | `payout` |
| currency IDs | ISO codes (`"NGN"`, `"USD"`) are accepted as `*_currency_id` | `getFees`, `payout` |
| bank payouts | `bank_id` from `banks.list`, `account_number`, `account_name` | payee form, `payout` |
| webhooks | headers `x-blaaiz-signature` and `x-blaaiz-timestamp`, HMAC-SHA256 of `timestamp.body` | `verifyWebhook` (SDK) |

## Safety switches that stay on in live mode

- Every rule is checked twice: when Bursar proposes, and again with live balances and a fresh Blaaiz fee preview right before any call.
- One payout per payment occurrence: `merchant_reference` acts as the idempotency key.
- **Pause** (per company) stops all execution, approvals included.
- Webhooks with a bad signature are stored and rejected.
