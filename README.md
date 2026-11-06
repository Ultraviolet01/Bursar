# Bursar

An autonomous treasury agent for companies, built on Blaaiz. Bursar watches a company's NGN and USD wallets, forecasts upcoming payments, and pays, swaps, defers or escalates. It always stays inside hard limits the owner sets.

- One founder account can run several companies. Each company has its own wallets, payees, rules, approvals and Blaaiz credentials.
- Built for the Blaaiz Buildathon (GDG Ilorin x Blaaiz).

## Quick start (mock mode)

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

- Landing page: http://localhost:3000
- Sign in: http://localhost:3000/signin with `founder@bursar.demo` / `bursar-demo` (demo seed only).
  - This founder runs two companies: Kaduna Freight Ltd and Ilorin Agro Foods.
- Or create your own account at `/signup`. Onboarding asks for your first company.
- Optional scheduler (hourly by default): `npm run worker`
- Run one cycle for every company from the terminal: `npm run cycle`
- Reset the demo at any time: `npm run db:seed`

Mock mode is the default and needs no Blaaiz credentials. Balances, rates, payouts and signed webhooks are all simulated.

## Lifecycle

### A cycle

A cycle runs per company:
- On a schedule (`npm run worker`).
- When the owner presses **Run cycle**.
- When an external scheduler calls `POST /api/cycle` with `Authorization: Bearer $CRON_SECRET`.

```
Observe  ->  Forecast  ->  Decide  ->  Policy check  ->  Act  ->  Reconcile
balances     14 days per    PAY / SWAP_THEN_PAY /   pass + auto-execute -> executor -> Blaaiz
rates        currency       DEFER / ESCALATE /      otherwise           -> proposal (owner)
fee quotes                  top-up SWAP
```

1. **Observe**: syncs wallet balances, the USD/NGN rate and its 7-day average, and a fee quote for every unpaid payment in the horizon.
2. **Forecast**: projected balance per currency. Flags the first day a wallet would drop below its buffer.
3. **Decide**: walks payments due today or overdue in priority order (payroll, critical vendors, SaaS and domains, others) and reserves funds as it goes.
   - **PAY**: the payee is allowlisted, the payment is under the caps, and the wallet stays above its buffer.
   - **SWAP_THEN_PAY**: the wallet is short. Another wallet can cover the exact shortfall, the pair is allowed, the rate is within band, and the swap is under the swap cap.
   - **DEFER**: the wallet is short, nothing can cover it, and the payment is not critical. After the max defer window it escalates instead.
   - **ESCALATE**: new payee, over a cap, short on a critical payment, or a payout that failed.
   - **SWAP** (top-up): a future bill would push a wallet below its buffer.
4. **Policy check and Act**: every action goes through the policy engine.
   - If every check passes and auto-execute is on, the executor calls Blaaiz.
   - Otherwise the action becomes a proposal in **Approvals**.
   - The executor re-checks every rule with live balances right before it calls Blaaiz.
5. **Reconcile**: Blaaiz webhooks (`payout.processing`, `payout.completed`, `payout.failed`, deposits) update payments. Polling `getTransaction` is the fallback.

### A payment

```
SCHEDULED --cycle--> auto PAY ----------------> EXECUTING --payout.completed--> PAID --> next occurrence SCHEDULED (if recurring)
    |                                               |
    |--cycle--> DEFERRED --next cycle--> (re-decided; escalates after max defer window)
    |                                               '--payout.failed--> PROPOSED (PAYOUT_FAILED), funds returned
    '--cycle--> PROPOSED --owner approves--> live policy re-check --> EXECUTING --> PAID
                     '----owner rejects----> CANCELLED (recurring schedule continues)
```

- One payout per occurrence, keyed by `merchant_reference = bursar-{paymentId}-{dueDate}`. Running a cycle twice never pays twice.
- **Pause** (the kill switch) is per company. Cycles still propose, but nothing executes, not even approvals.

### An account

```
Sign up -> onboarding (first company) -> dashboard
Sign in -> last active company        -> switch or add companies from the sidebar -> Sign out
```

## What the dashboard looks like

- **Overview**: total treasury (count-up), 14-day forecast chart, needs-you inbox, wallet cards, recent decisions, upcoming payments, active rules.
- **Approvals**: waiting and decided proposals, money flow, Bursar's reasons, live policy checks, approve or reject.
- **Payments**: schedule with filters, create and cancel.
- **Payees**: allowlist and critical toggles, add form. New payees start off the allowlist.
- **Activity**: stats, filters, every action with the rule it checked and its Blaaiz reference, system log, webhooks.
- **Rules**: caps, buffers, pairs, rate band, horizon, defer window, auto-execute.
- **Wallets**: per-wallet 14-day balance walk, shortfall callout, wallet rules, simulated deposits in mock mode.
- **Settings**: company name, per-company Blaaiz credentials (live mode), webhook URL, test webhook, list of your companies.

### Interaction and motion

- The sidebar is fixed on desktop and never scrolls with the page. On phones it is a slide-in drawer.
- The sidebar holds:
  - The company switcher.
  - Navigation with an animated active marker.
  - A live "running" pulse.
  - The pause switch.
  - Sign out.
- Every form button shows a spinner while it works and blocks double submits.
- Results appear as toasts (for example "Cycle finished: 5 paid, 2 swaps, 1 waiting for you").
- Pages fade in on navigation. Cards lift on hover. Money figures count up. The forecast line draws itself in.
- On the landing page, sections reveal on scroll.
- The landing hero is a looping motion piece:
  - A small payment keeps the ship's painted line above water.
  - A large one sinks the line, so the payment waits for the owner.

### Accessibility (WCAG 2.1 AA)

- Every text and background pair meets 4.5:1 contrast. The palette was measured, and the tokens were darkened where they fell short.
- Visible focus rings on everything interactive, a skip link, `aria-current` on navigation, labelled form fields, and errors announced with `role="alert"`.
- Toasts live in a polite live region.
- The forecast chart can be read with the arrow keys and has a hidden data table for screen readers.
- The hero animation has a pause button (WCAG 2.2.2). All motion is turned off for people who set "reduce motion".
- Works at 390px wide with no sideways scrolling.
- `npm run e2e` runs axe-core (WCAG 2.0 and 2.1, A and AA rules) on every page and fails on any violation.

## Testing

- `npm test` (Vitest, 46 tests):
  - Every reason code.
  - Policy checks.
  - Idempotency, pause, failed payouts and webhook signatures.
  - Isolation between companies.
  - Password and secret encryption.
- `npm run e2e` drives a real browser through the whole lifecycle, plus the axe scan. Start the app first (`npm run build && npm start`). It re-seeds the database.
  - Sign in, run a cycle, webhooks settle payouts, approve the escalation.
  - Run again (nothing pays twice), pause and resume.
  - Switch company and check isolation, add a company.
  - Sign out, then sign up as a new founder with onboarding.
  - Use the drawer on a phone.

## Live sandbox

1. Set `BLAAIZ_MODE=live` and `BURSAR_SECRET_KEY` (32+ random characters) in `.env`.
2. For each company, open **Settings**. Enter that business's Blaaiz customer ID, OAuth client ID, client secret and webhook signing secret.
   - Secrets are encrypted with AES-256-GCM and never shown again.
   - `BLAAIZ_CLIENT_ID` and `BLAAIZ_CLIENT_SECRET` in `.env` act as a fallback.
3. Register `https://<your-host>/api/webhooks/blaaiz/<companyId>` in each business's Blaaiz dev dashboard. The exact URL is on the Settings page.

Blaaiz only gives API access to registered businesses, so the live path compiles and validates every response with zod but has not been run against the sandbox yet (milestone M7).

## Security notes

- Passwords are hashed with scrypt and a per-user salt.
- Sessions are random 32-byte tokens in an httpOnly cookie. Only their SHA-256 is stored.
- Every server action and API route resolves the signed-in founder's own company and only reads or writes records that belong to it.
- Webhooks are verified per company (HMAC-SHA256 over `timestamp.body`). They are stored raw before processing and de-duplicated.
- Not done yet: rate limiting on sign in, email verification, password reset, and inviting teammates to a company.

## How it is built

- Next.js (App Router), Tailwind, Prisma with SQLite, zod, `blaaiz-nodejs-sdk`, node-cron, Vitest, Playwright with axe-core.
- Money is integer minor units everywhere (BigInt in the database). Never floats.
- `decide.ts` and `policy.ts` are pure functions. No LLM is involved anywhere.

```
src/
  blaaiz/      client.ts (interface), mock.ts, live.ts (SDK + zod), signature.ts, index.ts (one client per company)
  engine/      observe, forecast, decide, policy, execute (only swap/payout caller), reconcile, cycle, approvals
  webhooks/    handler.ts (shared by POST /api/webhooks/blaaiz/[companyId] and mock deliveries)
  lib/         auth (sessions), crypto, companies (create + demo data), repo, dashboard read models
  app/         landing, (auth) sign in and sign up, onboarding, /app dashboard, API routes
prisma/        schema.prisma, seed.ts
tests/         unit and integration tests
scripts/       run-cycle.ts, e2e.mjs
worker.ts      node-cron scheduler (all companies)
```

## Where this differs from the spec

- **Multiple companies per deployment.** The spec scoped one company per deployment. Founders asked to run more than one, so every record is scoped by company.
- **Per-payment cap compares what the payee receives, not amount plus fee.**
  - Otherwise the spec's own demo (a USD 1,500 contractor with a USD 1,500 cap) would escalate instead of `SWAP_THEN_PAY`.
  - Fees still count toward the daily cap and buffers.
- **The USD 120 SaaS bill is `SWAP_THEN_PAY`.** The decision rules allow a swap whenever another wallet has surplus.
- **Webhook verification needs a timestamp.** The SDK signs `HMAC-SHA256(timestamp + "." + body)` and reads both `x-blaaiz-timestamp` and `x-blaaiz-signature`.
- **Rejecting a proposal cancels that payment occurrence.** Recurring payments keep their schedule.
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
- M5 Dashboard: done, plus accounts, multiple companies, motion and WCAG 2.1 AA
- M6 Webhooks and reconcile: done, per company
- M7 Live sandbox: waiting on credentials
- M8 Demo polish: `npm run e2e` walks the whole demo in a browser
