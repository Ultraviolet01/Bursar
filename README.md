# Bursar

An autonomous treasury agent for companies, built on Blaaiz. Bursar watches a company's NGN and USD wallets, forecasts upcoming payments, and pays, swaps, defers or escalates. It always stays inside hard limits the owner sets.

Built for the Blaaiz Buildathon (GDG Ilorin x Blaaiz).

## Quick start (mock mode)

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

- Landing page: http://localhost:3000
- Dashboard: http://localhost:3000/app
- Optional scheduler (hourly by default): `npm run worker`
- Run one cycle from the terminal: `npm run cycle`
- Tests: `npm test`
- Reset the demo at any time: `npm run db:seed`

Mock mode is the default and needs no Blaaiz credentials. Balances, rates, payouts and signed webhooks are all simulated.

## Demo script (under 5 minutes)

1. Run `npm run db:seed` and open `/app`.
   - Kaduna Freight Ltd holds NGN 8,000,000 and USD 1,200.
   - It has 8 scheduled payments.
2. Press **Run cycle** on the Overview. Bursar:
   - Pays the 3 salaries automatically (`ROUTINE_OK`).
   - Swaps NGN to USD for the exact shortfall, then pays the USD 1,500 designer (`SWAP_THEN_PAY`, `amount_type: "to"`).
   - Swaps again and pays the USD 120 hosting bill, because NGN still has surplus.
   - Escalates the NGN 2,500,000 new vendor (`NEW_PAYEE`, `OVER_PAYMENT_CAP`, `OVER_DAILY_CAP`).
   - Leaves the domain renewal due in 5 days to the forecast.
3. About 3 seconds later, mock `payout.completed` webhooks arrive through the same handler real webhooks use.
   - Payments flip to Paid.
   - The next monthly occurrences are scheduled.
4. Open **Approvals** to see the escalation:
   - The money flow.
   - Bursar's numbered reasons.
   - Every policy check.
5. Approve it. It is re-checked live and then executed.
6. Press **Run cycle** again. Nothing pays twice.
7. **Pause all payments** in the sidebar, then try to approve something. It is blocked.
8. Try a failure: set a payee's account number to `0000000000`.
   - Their next payout fails.
   - The funds return to the wallet.
   - An escalation (`PAYOUT_FAILED`) appears.
9. **Activity, System log** shows every cycle, decision and webhook, including rejected signatures.

## Live sandbox

1. Set `BLAAIZ_MODE=live` in `.env`.
2. Fill in `BLAAIZ_CLIENT_ID`, `BLAAIZ_CLIENT_SECRET`, `BLAAIZ_WEBHOOK_SECRET` and `BLAAIZ_CUSTOMER_ID`.
3. Expose `/api/webhooks/blaaiz` with a tunnel and register it in the dev dashboard.
4. Only the client changes; engine code is identical in both modes.

Blaaiz only gives API access to registered businesses, so the live path compiles and validates every response with zod but has not been run against the sandbox yet (milestone M7).

## How it works

- **Five-stage cycle**, triggered by a schedule, the Run cycle button, or `POST /api/cycle`:
  - Observe: balances, rates, fee quotes.
  - Forecast: projected balance per currency over a 14-day horizon.
  - Decide: payments in priority order (payroll, critical vendors, SaaS and domains, others).
  - Act: auto-execute what passes policy, propose everything else.
  - Reconcile: webhooks, plus polling `getTransaction` as a fallback.
- **Deterministic money**:
  - `decide.ts` and `policy.ts` are pure functions with unit tests for every reason code.
  - No LLM is involved anywhere. Explanations are templated.
- **Policy is enforced twice**:
  - Once when an action is proposed.
  - Again with live balances inside `execute.ts`, right before Blaaiz is called.
  - `needs_owner` checks can be cleared by an approval. Hard failures (paused, insufficient funds, pair not allowed) cannot.
- **Idempotency**:
  - One payout per payment occurrence, keyed by `merchant_reference = bursar-{paymentId}-{dueDate}`.
  - Webhooks are stored raw first, then de-duplicated per event and transaction.
- **Money** is integer minor units everywhere (BigInt in the database). Never floats.

### Layout

```
src/
  blaaiz/      client.ts (interface), mock.ts, live.ts (SDK + zod), signature.ts, index.ts
  engine/      observe, forecast, decide, policy, execute (only swap/payout caller), reconcile, cycle, approvals
  webhooks/    handler.ts (shared by POST /api/webhooks/blaaiz and mock deliveries)
  app/         landing page, /app dashboard, API routes
prisma/        schema.prisma, seed.ts
tests/         unit tests for the engines and integration tests for the acceptance criteria
worker.ts      node-cron scheduler
```

### Dashboard

The screens follow the reference designs: sidebar with status card and pause switch, serif amounts, amber "needs you" states, and an approvals inbox with money flow, reasons and policy checks.

- **Overview**: total treasury, 14-day forecast chart, needs-you inbox, wallet cards, recent decisions, upcoming payments, active rules.
- **Approvals**: waiting and decided proposals, detail with money flow, reasons, live policy checks, approve or reject.
- **Payments**: schedule with status and category filters, create, cancel.
- **Payees**: allowlist and critical toggles, add form. New payees start off the allowlist.
- **Activity**: stats, filters, table with the rule checked and the Blaaiz reference, system log, webhooks.
- **Rules**: caps, buffers, pairs, rate band, horizon, defer window, auto-execute.
- **Wallets**: per-wallet 14-day balance walk, shortfall callout, wallet rules, simulated deposits (mock).
- **Settings**: mode, connection status, webhook URL, test webhook.

The landing hero reproduces the provided motion study in SVG and CSS on an 8-second loop:
- A small payment keeps the ship's painted line above water.
- A large one sinks the line, so the payment waits for the owner.
- Respects `prefers-reduced-motion`.

## Where this differs from the spec

- **Per-payment cap compares what the payee receives, not amount plus fee.**
  - Otherwise the spec's own demo (a USD 1,500 contractor with a USD 1,500 cap) would escalate instead of `SWAP_THEN_PAY`.
  - Fees still count toward the daily cap and buffers.
- **The USD 120 SaaS bill is `SWAP_THEN_PAY`, not PAY or DEFER.**
  - The decision rules allow a swap for any payment when another wallet has surplus.
- **Webhook verification needs a timestamp.**
  - The SDK signs `HMAC-SHA256(timestamp + "." + body)` and reads `x-blaaiz-timestamp` as well as `x-blaaiz-signature`.
  - `verifyWebhook` takes both.
- **Rejecting a proposal cancels that payment occurrence.**
  - Recurring payments keep their schedule.
- **Unverified against the live sandbox:**
  - Rate list shape.
  - Currency IDs (assumed to be ISO codes).
  - Wallet response wrapping.
  - The live client parses these defensively and fails the cycle loudly on an unexpected shape.

## Milestones

- M1 Scaffold: done
- M2 Blaaiz layer: done (live client compiles, not yet run against the sandbox)
- M3 Engines: done, every reason code tested
- M4 Executor and cycle: done, idempotency tested
- M5 Dashboard: done
- M6 Webhooks and reconcile: done
- M7 Live sandbox: waiting on credentials
- M8 Demo polish: demo script above
