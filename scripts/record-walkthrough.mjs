// Records a ~3 minute captioned walkthrough of Bursar against a local, freshly seeded server.
// npm start (with ENABLE_TEST_LOGIN=1), then: node scripts/record-walkthrough.mjs <outDir>
// Wipes the local database first. Never point it at production.
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const OUT = process.argv[2];
const HERE = new URL(".", import.meta.url).pathname;
const B = "http://localhost:3000";
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fresh data: no founders yet, rates history in place.
execSync("npx tsx prisma/seed.ts", { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
execSync(`node -e "const{PrismaClient}=require('@prisma/client');const d=new PrismaClient();(async()=>{await d.session.deleteMany();await d.ledgerEntry.deleteMany();await d.execution.deleteMany();await d.action.deleteMany();await d.cycle.deleteMany();await d.scheduledPayment.deleteMany();await d.payee.deleteMany();await d.walletSnapshot.deleteMany();await d.wallet.deleteMany();await d.webhookEvent.deleteMany();await d.auditLog.deleteMany();await d.policy.deleteMany();await d.company.deleteMany();await d.user.deleteMany();await d.mockTransaction.deleteMany();await d.mockWallet.deleteMany();await d.\\$disconnect()})()"`, { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, acceptDownloads: true, colorScheme: "light" });

// Caption bar and a visible cursor, kept across navigations.
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById("demo-cap")) return;
    // Show sign-in exactly as production does: the local test form never appears there.
    const st = document.createElement("style");
    st.textContent = 'form[action="/auth/test-login"]{display:none!important}';
    document.documentElement.appendChild(st);
    const cap = document.createElement("div");
    cap.id = "demo-cap";
    cap.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:min(980px,92vw);background:rgba(15,45,58,.94);color:#fff;font:500 19px/1.35 'Hanken Grotesk',system-ui,sans-serif;padding:12px 22px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center;transition:opacity .3s";
    cap.textContent = sessionStorage.getItem("demo-cap") || "";
    cap.style.opacity = cap.textContent ? "1" : "0";
    document.documentElement.appendChild(cap);
    const cur = document.createElement("div");
    cur.id = "demo-cursor";
    cur.style.cssText = "position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(195,138,38,.35);border:2px solid #C38A26;pointer-events:none;transition:transform .15s;left:-50px;top:-50px";
    document.documentElement.appendChild(cur);
    const pos = sessionStorage.getItem("demo-cur");
    if (pos) { const [x, y] = pos.split(","); cur.style.left = x + "px"; cur.style.top = y + "px"; }
    addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; sessionStorage.setItem("demo-cur", `${e.clientX},${e.clientY}`); }, true);
    addEventListener("mousedown", () => (cur.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (cur.style.transform = "scale(1)"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
});

const page = await ctx.newPage();
const say = async (text, hold = 0) => {
  await page.evaluate((t) => {
    sessionStorage.setItem("demo-cap", t);
    const c = document.getElementById("demo-cap");
    if (c) { c.textContent = t; c.style.opacity = t ? "1" : "0"; }
  }, text).catch(() => {});
  if (hold) await sleep(hold);
};
const glide = async (loc, opts = {}) => {
  const box = await loc.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await sleep(opts.pause ?? 350);
};
const click = async (loc, opts) => { await loc.scrollIntoViewIfNeeded(); await glide(loc, opts); await loc.click(); };
const scrollBy = async (dy, steps = 12) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(60); } };
const t0 = Date.now();
const mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s  ${s}`);

// 1. Landing
mark("landing");
await page.goto(B + "/", { waitUntil: "networkidle" });
await page.mouse.move(640, 360);
await say("Bursar is a treasury agent for companies, built on Blaaiz.", 3500);
await say("Small bills sit under your line, so Bursar pays them alone. Big ones sink the line and wait for you.", 6500);
await scrollBy(780, 14);
await say("It forecasts every wallet, pays or swaps when a bill is due, and asks you before anything over your line.", 4500);
await scrollBy(700, 14);
await say("Every payment is checked against your rules, twice, before Blaaiz is called. No AI model can approve money.", 4500);

// 2. Sign in with Google
mark("sign in");
await page.goto(B + "/signin", { waitUntil: "networkidle" });
await say("Founders sign in with Google. No passwords.", 1500);
await glide(page.getByRole("link", { name: "Continue with Google" }), { pause: 1800 });
await say("For this recording, a test account stands in for the Google pop-up.", 2500);
await page.goto(B + "/auth/test-login?email=amaka%40gmail.com&name=Amaka%20Eze", { waitUntil: "networkidle" });

// 3. Onboarding overlay
mark("onboarding");
await say("First sign-in: add a company, over a preview of the dashboard.", 2500);
await click(page.getByLabel("Company name"));
await page.getByLabel("Company name").pressSequentially("Kaduna Freight Ltd", { delay: 45 });
await say("Pick its currency wallets. Here we load the demo: NGN 8m, USD 1,200, salaries and bills due today.", 1200);
await click(page.getByLabel("Fill it with demo data"));
await page.getByLabel("Fill it with demo data").check();
await sleep(1500);
await click(page.getByRole("button", { name: "Create company" }));
await page.waitForURL(B + "/app");
await say("Bursar sets up Blaaiz on its own: wallets, the NGN funding account and webhooks.", 4000);

// 4. Overview and a cycle
mark("overview + cycle");
await say("Overview: total treasury across wallets and a 14-day forecast against your buffer.", 2000);
await glide(page.locator("svg[role=img]").first(), { pause: 400 });
for (let x = 0; x < 6; x++) { await page.mouse.move(450 + x * 90, 470, { steps: 6 }); await sleep(250); }
await sleep(1200);
await say("Run a cycle: observe, forecast, decide, act, reconcile, learn.", 1200);
await click(page.getByRole("button", { name: "Run cycle" }));
await page.locator('[role="status"] span.flex-1').filter({ hasText: /Cycle/ }).first().waitFor({ timeout: 20000 });
await say("Payroll paid from NGN. One NGN to USD rebalance covers both USD bills, then pays them. One new vendor waits for you.", 6000);
await scrollBy(900, 12);
await say("Every decision shows the rule it checked.", 3500);
await scrollBy(-900, 8);

// 5. Approvals
mark("approvals");
await click(page.getByRole("link", { name: /Review 1 item/ }));
await page.waitForURL(/approvals/);
await say("Approvals: Zaria Haulage is a new payee and over your NGN 2m per-payment line.", 4000);
await scrollBy(560, 12);
await say("Bursar explains why, and lists every policy check: pass, needs you, or blocked.", 4500);
await scrollBy(500, 10);
await click(page.getByRole("button", { name: "Approve and run" }));
await page.locator('[role="status"] span.flex-1').filter({ hasText: /Approved/ }).first().waitFor({ timeout: 20000 });
await say("Approved. The rules are re-checked live and Blaaiz's fee is previewed right before the payout.", 4000);

// 6. Activity and Learn
mark("activity");
await click(page.getByRole("link", { name: "Activity" }).first());
await page.waitForURL(/activity/);
await say("Activity: stats, and what Bursar learned from your decisions and the rates it got.", 4000);
await scrollBy(520, 10);
await say("Each row: what happened, the outcome, the rule it checked and the Blaaiz reference.", 4000);

// 7. Excel export
mark("excel");
await scrollBy(-1200, 6);
const [download] = await Promise.all([page.waitForEvent("download"), click(page.getByRole("link", { name: "Export to Excel" }))]);
await say("Export to Excel downloads a workbook for this company.", 1500);
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
execFileSync("node", [`${HERE}xlsx-preview.mjs`, file, `${OUT}/report.html`]);
await page.goto(`file://${OUT}/report.html`);
await say("Summary: balances, total treasury, counts and your rules.", 3500);
for (const [tab, text] of [
  ["Activity", "Activity: every decision with its outcome, rule and Blaaiz reference."],
  ["Payments", "Payments: the schedule, statuses and the merchant reference that stops double payments."],
  ["Ledger", "Ledger: every payout, fee and swap, signed, per wallet."],
  ["Wallets", "Wallets: balance, buffer, rate and the NGN funding account."],
]) {
  await click(page.locator(".tab", { hasText: tab }));
  await say(text, 3300);
}

// 8. Wallets and rebalancing
mark("wallets");
await page.goto(B + "/app/wallets?c=USD", { waitUntil: "networkidle" });
await say("Wallets: each one is kept above its buffer. Here is the USD wallet after the rebalance.", 3500);
await scrollBy(800, 12);
await say("Fund NGN by bank transfer to the account Blaaiz created, or convert between your own wallets.", 4000);
await scrollBy(700, 12);
await say("The ledger records the swap in and every payout and fee.", 3500);

// 9. Rules
mark("rules");
await page.goto(B + "/app/rules", { waitUntil: "networkidle" });
await say("Rules are your line: caps, buffers, allowed swap pairs, rate band and auto-execute.", 4500);

// 10. A second company
mark("second company");
await page.goto(B + "/app", { waitUntil: "networkidle" });
await click(page.getByRole("button", { name: /Switch company$/ }));
await say("One founder can run several companies.", 1200);
await click(page.getByRole("link", { name: "+ Add a company" }));
await page.waitForURL(/companies\/new/);
await page.getByLabel("Company name").pressSequentially("Ilorin Agro Foods", { delay: 40 });
await click(page.getByRole("button", { name: "Create company" }));
await page.waitForURL(B + "/app");
await say("Each company gets its own wallets, payees, rules and approvals, set up automatically.", 4000);

// 11. Dark mode and close
mark("dark + close");
await click(page.getByRole("radio", { name: "Dark" }).first());
await say("Dark mode, accessible in both themes. It works on phones too.", 3500);
await page.goto(B + "/app/approvals", { waitUntil: "networkidle" });
await sleep(1500);
await click(page.getByRole("radio", { name: "Light" }).first());
await page.goto(B + "/", { waitUntil: "networkidle" });
await say("Bursar. Runs your treasury, never past your line. bursar-beta.vercel.app", 5000);
mark("end");

const video = page.video();
await ctx.close();
await browser.close();
console.log("VIDEO", await video.path());
