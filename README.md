# Bursar

An autonomous treasury agent for companies, built on Blaaiz. Bursar watches a company's NGN, USD, GBP and EUR wallets, forecasts upcoming payments, and pays, defers or escalates. Bursar pays routine bills on its own, but every currency swap waits for the founder's approval. It always stays inside hard limits the owner sets.

- One founder account can run several companies. Each company has its own wallets, payees, rules, approvals and Blaaiz credentials.
- Built for the Blaaiz Buildathon (GDG Ilorin x Blaaiz).

  https://github.com/user-attachments/assets/74a1ff11-799d-48b9-aa55-c369b4e71e4a

## The problem

Managing multi-currency cash and paying company bills is manual, slow and error-prone.

1. **Cash sits in the wrong currency.**
   - A company receives money in NGN but needs to pay salaries or vendors in USD or EUR.
   - Someone has to notice the imbalance, check rates, and convert by hand.
   - If they wait too long, the rate moves against them or a payment fails.
2. **Bills get paid late, or need constant attention.**
   - Payroll, domain renewals, SaaS tools and vendor invoices arrive on different schedules and in different currencies.
   - A founder or finance person has to remember each one, check balances, convert if needed, and send the payment.
   - Miss one and something breaks: the domain expires, an employee is not paid, a tool gets cut off.
3. **No continuous view.**
   - Most small and mid-size companies still work in periodic cycles: check balances, review bills, convert, pay, reconcile.
   - By the time they act, the situation has already changed.
4. **Idle or trapped cash.**
   - There is surplus in one currency while another is short.
   - Or cash just sits there, with no one watching whether it should be converted for an upcoming need.

## How Bursar solves it

Bursar is a treasury agent that watches every wallet continuously and acts on Blaaiz, inside limits the founder sets.

| Problem | What Bursar does |
|---------|------------------|
| Cash in the wrong currency | Spots the imbalance before a bill is due. It proposes one swap from the wallet that has surplus, with the rate and fee previewed. The founder approves it, and Bursar then pays the bills that were waiting on it. It does not propose swaps when the rate is worse than its 7-day average by more than your band. |
| Late bills, constant attention | Knows every scheduled bill: payroll, domains, SaaS, vendors. Each cycle it pays what is due in priority order, payroll first. When a currency is short it proposes a swap and holds those bills until you approve. It defers what can wait, and asks the owner about anything outside the rules. |
| No continuous view | Runs every 10 minutes, and whenever a bill is added, money arrives or a swap is approved. It forecasts each wallet 14 days ahead and flags the day any of them would drop below its buffer. |
| Idle or trapped cash | Watches surplus against upcoming needs, and proposes top-up swaps before a wallet runs short, not after. A buffer per wallet keeps enough cash in place for what is coming. |

Money decisions come from fixed, tested rules, not an AI model.

- Every action is checked twice before Blaaiz is called.
- No bill is paid twice.
- Every decision is recorded with the rule it checked, and can be exported to Excel.
- The founder can pause everything at any time.

## Quick start (mock mode)

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

- Landing page: http://localhost:3000
- Sign in: http://localhost:3000/signin. Without Google keys, set `ENABLE_TEST_LOGIN=1` and use the local test sign-in with `founder@bursar.demo` (the demo seed).
  - This founder runs two companies: Kaduna Freight Ltd and Ilorin Agro Foods.
- Or create your own account at `/signup`. Onboarding asks for your first company.
- Optional scheduler (every 10 minutes by default): `npm run worker`
- Run one cycle for every company from the terminal: `npm run cycle`
- Reset the demo at any time: `npm run db:seed`

Mock mode is the default and needs no Blaaiz credentials. Balances, rates, payouts and signed webhooks are all simulated.

## Deploying on Vercel

Live demo: https://bursar-beta.vercel.app (mock mode; sign in with Google).

- Production uses Postgres, because Vercel functions have no persistent disk. Add **Neon** from the project's Storage tab; it sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
- `npm run vercel-build` (which Vercel runs automatically):
  - Generates a Postgres version of the Prisma schema and pushes it.
  - Seeds the demo only on an empty database.
  - Builds the app.
- Local development and tests keep SQLite.
- Environment variables to set:
  - `BLAAIZ_MODE`, `APP_URL`.
  - `BURSAR_SECRET_KEY`, `CRON_SECRET`, `BLAAIZ_WEBHOOK_SECRET`: random, 32+ characters each.
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `vercel.json` runs a cycle once a day, the Hobby plan's limit. On Pro, change the schedule to `*/10 * * * *`.
- Cycles also run on every new bill, deposit, approval and manual run.
- Add `<APP_URL>/auth/google/callback` to the Google OAuth client's redirect URIs.

## Walkthrough video

<!-- To embed: edit this README on github.com, drag bursar-walkthrough.mp4 onto this line, and commit.
     GitHub stores the video outside the repository and plays it inline. -->

A 2:48 narrated walkthrough. It shows:
- The landing page.
- Google sign-in.
- Onboarding, with automatic Blaaiz setup.
- A cycle with a rebalance, and approving a proposal.
- Activity, and the Excel export.
- Wallets and Rules.
- A second company, and dark mode.

Narrated with a local text-to-speech voice. To rebuild it, see [scripts/walkthrough](scripts/walkthrough/README.md).

## How founders sign up

Founders sign in with **Google only**: Gmail or Google Workspace. There are no passwords and no emailed links.

- "Continue with Google" uses OpenID Connect with PKCE, state and nonce.
- Bursar checks the ID token's signature against Google's keys, and accepts only Google-verified emails.
- The first sign-in creates the account. Onboarding then asks for the first company.
- Setup:
  - Create an OAuth client in Google Cloud Console (type: Web application).
  - Add `<APP_URL>/auth/google/callback` as a redirect URI.
  - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
  - While the consent screen is in Testing, only the test users you list there can sign in.
- For local development and the browser test without Google, `ENABLE_TEST_LOGIN=1` turns on `/auth/test-login`. It is always off on Vercel, whatever the variable says.

## Lifecycle

Blaaiz is the only money rail. Bursar decides and calls the API, always inside the hard rules the owner sets.

### 1. Setup (one-time)

The Overview shows these five steps as a checklist until each is done.

1. **Create currency wallets.** Choose NGN (always), USD, EUR and GBP when you add a company, or later with **Add wallet**.
   - In live mode, wallets are created in the Blaaiz dashboard and Bursar uses the ones Blaaiz returns.
   - The Blaaiz development sandbox only settles NGN and USD.
2. **Register payees with Blaaiz.** Employees and key vendors become Blaaiz customers (`customers.create`).
   - Blaaiz needs an email, country, ID type and ID number for each one.
   - Allowlisting a payee registers them automatically once those details are filled in.
3. **Fund NGN by bank transfer.** **Create funding account** gives the NGN wallet its own virtual bank account (`virtualBankAccounts.create`).
   - A deposit webhook updates balances and starts a cycle.
4. **Swap into your other currencies.** **Convert** on Wallets swaps between your own wallets.
   - The rate and fee are previewed first, and every rule is still checked.
5. **Set your hard rules:**
   - A buffer per wallet.
   - Per-payment caps per currency.
   - A daily cap.
   - A swap cap.
   - Allowed currency pairs.
   - A rate band.
   - The defer window.
   - Auto-execute.

### 2. Continuous loop (every run)

| Stage | What happens |
|-------|--------------|
| **Observe** | Pull every wallet balance and the NGN rate for each currency (plus a 7-day average). Load bills inside the horizon (salaries, domains, SaaS, vendors) and a fee quote for each. |
| **Forecast** | Projected balance per currency after upcoming bills. Flags the first day each wallet would fall below its buffer. |
| **Decide** | In priority order. 1) Pay due bills from the currency already held, payroll first. 2) **Rebalance**: propose one swap per short currency from the wallet with the most surplus above its buffer. 3) Pay the bills that swap funds, once the founder approves it. 4) Defer non-critical bills when cash is tight or the rate is poor. 5) Escalate anything outside the rules. Then propose top-ups for wallets forecast to dip below their buffer. |
| **Act** | Preview the fee and rate with Blaaiz. Re-check every rule with live balances. Then `POST /payout` for routine bills inside the rules. Every swap, and anything outside the rules, becomes a proposal; `POST /swap` only runs after the founder approves. |
| **Reconcile** | Payout webhooks and transaction status mark bills paid or failed. Every movement goes into the local ledger: payouts, fees, swaps in and out, deposits, refunds. |
| **Learn** | Log outcomes: approvals against rejections by reason, the rates swaps got against the 7-day average, and what happened to deferred bills. Repeated patterns become rule suggestions in Approvals. |

### 3. Decision rules

- **Pay** when:
  - The bill is due.
  - The payee is allowlisted.
  - The amount is within the caps.
  - The wallet stays above its buffer afterwards.
- **Swap (rebalance)** when a currency needed now is short and another wallet has surplus above its buffer.
  - The swap must use an allowed pair, within the rate band.
  - The swap brings in enough to refill the buffer too.
  - **Every swap waits for the founder.** Bursar never swaps on its own. It is a hard rule in the policy engine that no setting turns off. The bills a swap funds are held until you approve it, then paid straight away.
- **Defer** when the bill is not critical and cash is tight or the rate is poor. After the max defer window it escalates instead.
- **Escalate** for new payees, amounts over a cap, critical shortfalls, failed payouts, or any rule violation.

### Rebalancing

Rebalancing moves money between this company's own wallets so no currency runs dry while another sits idle. Bursar proposes it; the founder approves it; then it is a `POST /swap` between two wallets of the same business.

- Only between this business's own wallets. A policy check confirms both wallets belong to the company.
- Never takes the source wallet below its buffer, and refills the target's buffer.
- Covers due critical bills (payroll first) before any opportunistic top-up.
- Previews the rate and fee before swapping, and writes every swap to the ledger.
- One rebalance per currency per cycle. While one waits for you, the bills it would fund are held, not re-proposed.
- If you reject a rebalance, it is not proposed again that day. The critical bills then come to you instead.

### 4. What the owner sees

- Current balances per currency, with each wallet's buffer, runway and ledger.
- Upcoming payments and the 14-day forecast.
- Proposals: payments, rebalances, top-ups, and rule suggestions from Learn.
- A history of executed actions, with the rule each one checked and its Blaaiz reference.
- An approve button for anything outside the hard limits.

### 5. Run cadence

- Every 10 minutes by default (`CYCLE_CRON`, any value from 5 to 15 minutes works), or on demand with **Run cycle**.
- A cycle also runs straight away when:
  - A new bill is added.
  - A deposit webhook arrives.
  - You approve a swap (so the bills it funded get paid).
  - You convert currencies.

### A payment, end to end

```
SCHEDULED --cycle--> PAY (from own currency or after a rebalance) --> EXECUTING --payout.completed--> PAID --> next occurrence (if recurring)
    |                     '-- rebalance waiting for you --> HOLD --you approve the swap--> follow-up cycle pays it
    |--cycle--> DEFERRED --next cycle--> re-decided (escalates after the max defer window)
    '--cycle--> PROPOSED --you approve--> preview + live policy check --> EXECUTING --> PAID
                     '----you reject----> CANCELLED (recurring schedule continues)
payout.failed --> funds refunded (ledger) --> PROPOSED (PAYOUT_FAILED)
```

### An account

```
Sign up -> add your first company (blurred dashboard behind) -> dashboard with the setup checklist
Sign in -> last active company -> switch or add companies from the sidebar -> Sign out
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

## Testing

- `npm test` (Vitest, 59 tests):
  - Every reason code.
  - Policy checks.
  - Idempotency, pause, failed payouts and webhook signatures.
  - Isolation between companies.
  - Rebalance order, held bills, follow-up cycles and EUR rebalancing.
  - Ledger, fee previews, the Learn stage and deposit-triggered cycles.
  - Password and secret encryption.
- `npm run e2e` drives a real browser through the whole lifecycle, plus the axe scan. Start the app first (`npm run build && npm start`). It re-seeds the database.
  - Sign in, run a cycle, webhooks settle payouts, approve the escalation.
  - Run again (nothing pays twice), pause and resume.
  - Switch company and check isolation, add a company.
  - Sign out, then sign up as a new founder with onboarding.
  - Use the drawer on a phone.

## Live sandbox

See [docs/GOING_LIVE.md](docs/GOING_LIVE.md) for the full checklist. Run `npm run blaaiz:check` to test the keys read-only.

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
- Not done yet: inviting teammates to a company.

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

## Milestones

- M1 Scaffold: done
- M2 Blaaiz layer: done (live client compiles, not yet run against the sandbox)
- M3 Engines: done, every reason code tested
- M4 Executor and cycle: done, idempotency tested
- M5 Dashboard: done, plus accounts, multiple companies, motion and WCAG 2.1 AA
- M6 Webhooks and reconcile: done, per company
- M7 Live sandbox: waiting on credentials
- M8 Demo polish: `npm run e2e` walks the whole demo in a browser
