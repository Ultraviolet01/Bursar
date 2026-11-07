// End-to-end walkthrough in a real browser, plus a WCAG 2.1 AA scan of every page.
// Needs the app running (npm run build && npm start) in mock mode. Re-seeds the database first.
//   npm run e2e                 BASE_URL=http://localhost:3000 SHOTS=./e2e-shots npm run e2e
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const step = (title) => console.log(`\n${title}`);
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

/** Waits up to 10s for the locator to be visible. */
async function visible(locator) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Waits for a toast whose text matches, so an older toast is never mistaken for the new one. */
async function toast(page, match = /./) {
  const t = page.locator('[role="status"][aria-live="polite"] span.flex-1').filter({ hasText: match }).first();
  try {
    await t.waitFor({ timeout: 15000 });
    return (await t.innerText()).trim();
  } catch {
    const any = page.locator('[role="status"][aria-live="polite"] span.flex-1').first();
    return (await any.count()) ? `(no match) ${(await any.innerText()).trim()}` : "(no toast)";
  }
}

const a11y = [];
async function scan(page, label) {
  await page.waitForTimeout(1000); // let entrance animations finish so contrast is measured at rest
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(["region"]).analyze();
  a11y.push({ label, violations: res.violations });
  check(res.violations.length === 0, `WCAG 2.1 AA scan: ${label}${res.violations.length ? ` (${res.violations.map((v) => `${v.id} x${v.nodes.length}`).join(", ")})` : ""}`);
}

execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const page = await ctx.newPage();

step("1. Landing and auth gate");
await page.goto(`${BASE}/`);
check(await visible(page.getByRole("heading", { name: /Runs your treasury/ })), "landing renders the hero");
const pauseBtn = page.getByRole("button", { name: "Pause animation" });
await pauseBtn.click();
check((await page.getByRole("button", { name: "Play animation" }).getAttribute("aria-pressed")) === "true", "hero animation can be paused (WCAG 2.2.2)");
await scan(page, "landing");
await page.goto(`${BASE}/app/approvals`);
check(page.url().includes("/signin") && page.url().includes("next=%2Fapp%2Fapprovals"), "signed-out visit to /app redirects to sign in");
await scan(page, "sign in");

step("2. Sign in (Google only)");
check((await page.getByLabel("Password").count()) === 0 && (await page.getByLabel("Work email").count()) === 0, "no email or password fields on sign in");
if (process.env.GOOGLE_CLIENT_ID) {
  check(await visible(page.getByRole("link", { name: "Continue with Google" })), "Continue with Google is the way in");
  const resp = await page.request.get(`${BASE}/auth/google?next=%2Fapp%2Fapprovals`, { maxRedirects: 0 });
  const to = new URL(resp.headers()["location"] ?? "http://x");
  check(to.host === "accounts.google.com" && to.searchParams.get("code_challenge_method") === "S256" && to.searchParams.get("redirect_uri") === `${BASE}/auth/google/callback`, "Continue with Google redirects to Google with PKCE and the right callback");
  await page.goto(`${BASE}/auth/google/callback?state=forged&code=x`);
  check(await visible(page.getByRole("alert").filter({ hasText: /could not be matched|took too long/ })), "a forged Google callback is refused");
}
for (const gone of ["/forgot", "/reset", "/signin/link", "/signin/confirm", "/dev/mail", "/auth/verify"]) {
  const r = await page.request.get(`${BASE}${gone}`, { maxRedirects: 0 });
  check(r.status() === 404, `${gone} no longer exists (${r.status()})`);
}
// Google itself cannot be driven in a test; the guarded test sign-in stands in for it.
await page.goto(`${BASE}/auth/test-login?email=founder%40bursar.demo&next=%2Fapp%2Fapprovals`);
await page.waitForURL(/\/app\/approvals/);
ok("signed in and returned to the page originally asked for");
await page.goto(`${BASE}/app`);
check(await visible(page.getByRole("button", { name: /^Kaduna Freight Ltd.*Switch company$/ })), "active company is Kaduna Freight Ltd");

step("3. Sidebar stays fixed while the page scrolls");
const before = await page.locator('aside[aria-label="Sidebar"]').boundingBox();
await page.mouse.wheel(0, 2000);
await page.waitForTimeout(300);
const after = await page.locator('aside[aria-label="Sidebar"]').boundingBox();
const scrolled = await page.evaluate(() => window.scrollY);
check(scrolled > 200 && before.y === after.y && after.y === 0, `sidebar did not move (page scrolled ${scrolled}px)`);
await page.evaluate(() => window.scrollTo(0, 0));
await scan(page, "overview (before cycle)");

step("4. Cycle: observe, forecast, decide, act, reconcile");
await page.getByRole("button", { name: "Run cycle" }).click();
const t1 = await toast(page, /Cycle/);
check(/5 paid, 1 swap, 1 waiting for you/.test(t1), `toast: "${t1}" (payroll from NGN, one NGN to USD rebalance, then the USD bills)`);
await page.waitForTimeout(4000); // mock payout.processing then payout.completed webhooks
await page.goto(`${BASE}/app/payments?status=PAID&category=ALL`);
check((await page.locator("tbody tr").count()) === 5, "5 payments reconciled to Paid by webhooks");
await page.goto(`${BASE}/app/payments?status=SCHEDULED&category=ALL`);
check((await page.getByText("Monthly").count()) >= 5, "next monthly occurrences were scheduled");
await shot(page, "payments");
await scan(page, "payments");
await page.goto(`${BASE}/app/activity?tab=swaps`);
check(await visible(page.getByRole("link", { name: "Rebalance NGN to USD" })), "activity shows the rebalance swap");
await page.goto(`${BASE}/app/wallets?c=USD`);
check((await page.locator("table").filter({ hasText: "Swap in" }).count()) === 1, "USD ledger records the swap and payouts");
await page.goto(`${BASE}/app`);
await shot(page, "overview");
await scan(page, "overview (after cycle)");

step("5. Approve the escalated new vendor");
await page.getByRole("link", { name: /Approvals/ }).first().click();
await page.waitForURL(/approvals/);
check(await visible(page.getByText("Zaria Haulage Ltd is not on your allowlist")), "reason: new payee explained");
check((await page.getByText("Needs you", { exact: true }).count()) >= 2, "policy checks show what needs the owner");
await shot(page, "approvals");
await scan(page, "approvals");
await page.getByRole("button", { name: "Approve and run" }).click();
const t2 = await toast(page, /#\d+/);
check(/Approved #\d+/.test(t2), `toast: "${t2}"`);
await page.waitForTimeout(3500);
await page.goto(`${BASE}/app/activity?tab=approved`);
check(await visible(page.getByRole("cell", { name: /Zaria Haulage/ }).first()), "activity shows the approved payout");
await scan(page, "activity");

step("6. Idempotency: run again, nothing pays twice");
await page.goto(`${BASE}/app`);
await page.getByRole("button", { name: "Run cycle" }).click();
const t3 = await toast(page, /Cycle/);
check(/Nothing due/.test(t3), `toast: "${t3}"`);

step("7. Kill switch");
await page.getByRole("button", { name: "Pause all payments" }).click();
check(/paused/i.test(await toast(page, /paused/i)), "pause confirmed");
check(await visible(page.getByText("Kaduna Freight Ltd is paused")), "paused banner shown");
await page.getByRole("button", { name: "Resume Bursar" }).click();
check(/resumed/i.test(await toast(page, /resumed/i)), "resume confirmed");

step("8. Second company: switch, isolation");
await page.getByRole("button", { name: /^Kaduna Freight Ltd.*Switch company$/ }).click();
await page.getByRole("button", { name: /^Ilorin Agro Foods$/ }).click();
await page.waitForURL(`${BASE}/app`);
check(await visible(page.getByRole("button", { name: /^Ilorin Agro Foods.*Switch company$/ })), "switched to Ilorin Agro Foods");
await page.goto(`${BASE}/app/payees`);
const names = await page.locator("tbody tr td:first-child div:first-child").allInnerTexts();
check(names.includes("Bola Adeyemi") && !names.includes("Ada Obi"), `Ilorin sees only its own payees (${names.join(", ")})`);
await scan(page, "payees");
await page.goto(`${BASE}/app`);
await page.getByRole("button", { name: "Run cycle" }).click();
const t4 = await toast(page, /Cycle/);
check(/swap|Nothing due|paid/.test(t4), `Ilorin cycle toast: "${t4}"`);
await page.goto(`${BASE}/app/wallets?c=USD`);
await shot(page, "wallets-ilorin");
await scan(page, "wallets");

step("9. Add a third company");
await page.getByRole("button", { name: /^Ilorin Agro Foods.*Switch company$/ }).click();
await page.getByRole("link", { name: "+ Add a company" }).click();
await page.waitForURL(/companies\/new/);
await scan(page, "add company");
await page.getByLabel("Company name").fill("Lagos Studio Ltd");
await page.getByRole("button", { name: "Create company" }).click();
await page.waitForURL(`${BASE}/app`);
check(await visible(page.getByRole("button", { name: /^Lagos Studio Ltd.*Switch company$/ })), "new company created and active");
step("9b. Setup lifecycle on the new company: fund NGN, convert into USD");
await page.goto(`${BASE}/app/wallets?c=NGN`);
await page.getByRole("button", { name: "Create funding account" }).click();
check(/Bank account ready/.test(await toast(page, /Bank account/)), "NGN funding account created (virtual account)");
await page.getByRole("button", { name: "Deposit" }).click();
check(/Deposited/.test(await toast(page, /Deposited/)), "deposit arrives by transfer (mock webhook)");
await page.goto(`${BASE}/app/wallets?c=USD`);
await page.getByLabel("USD to receive").fill("300");
await page.getByRole("button", { name: "Preview and convert" }).click();
check(/Converted/.test(await toast(page, /Convert/)), "converted NGN into USD between own wallets");
check((await page.locator("table").filter({ hasText: "Swap in" }).count()) === 1, "conversion is in the USD ledger");
await scan(page, "wallets (setup)");
await page.goto(`${BASE}/app/rules`);
await scan(page, "rules");
await page.goto(`${BASE}/app/settings`);
check((await page.getByRole("listitem").filter({ hasText: /Kaduna|Ilorin|Lagos/ }).count()) === 3, "settings lists all three companies");
await scan(page, "settings");

step("10. Sign out");
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL(/signin/);
await page.goto(`${BASE}/app`);
check(page.url().includes("/signin"), "after sign out, /app needs sign in again");

step("11. New founder: sign up and onboarding");
await page.goto(`${BASE}/signup`);
await scan(page, "sign up");
check((await page.getByLabel("Password").count()) === 0, "sign up has no password field");
await page.goto(`${BASE}/auth/test-login?email=amaka.${Date.now()}%40gmail.com&name=Amaka%20Eze`);
await page.waitForURL(/onboarding/);
check(await visible(page.getByRole("dialog", { name: "Add your first company" })), "onboarding opens as a dialog over the interface");
const blur = await page.locator(".onboarding-backdrop").evaluate((el) => getComputedStyle(el).filter);
check(/blur\(/.test(blur), `interface behind the dialog is blurred (${blur})`);
check((await page.locator(".onboarding-backdrop [inert]").count()) === 1, "blurred interface cannot be clicked or tabbed into");
await shot(page, "onboarding");
await scan(page, "onboarding");
await page.getByLabel("Company name").fill("Eze Logistics");
await page.getByLabel("Fill it with demo data").check();
await page.getByRole("button", { name: "Create company" }).click();
await page.waitForURL(`${BASE}/app`);
check(await visible(page.getByRole("button", { name: /^Eze Logistics.*Switch company$/ })), "new founder lands on their first company");
await page.waitForTimeout(900);
check((await page.locator(".onboarding-backdrop").count()) === 0 && (await page.getByRole("dialog").count()) === 0, "overlay is gone; the real interface is live");
check((await page.getByRole("button", { name: "Run cycle" }).isEnabled()), "founder can interact with the dashboard");
await shot(page, "after-onboarding");
await page.goto(`${BASE}/app/approvals`);
check((await page.getByText("Kaduna").count()) === 0, "new founder cannot see the demo founder's companies");

step("12. Phone: drawer navigation");
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const m = await phone.newPage();
await m.goto(`${BASE}/app`);
check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no sideways scroll at 390px");
await m.getByRole("button", { name: "Open menu" }).click();
await m.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Wallets" }).click();
await m.waitForURL(/wallets/);
ok("drawer opens and navigates");
await shot(m, "phone-wallets");

await browser.close();
console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
const total = a11y.reduce((s, p) => s + p.violations.length, 0);
if (total) for (const p of a11y) for (const v of p.violations) console.log(`  a11y ${p.label}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
process.exit(failures ? 1 : 0);
