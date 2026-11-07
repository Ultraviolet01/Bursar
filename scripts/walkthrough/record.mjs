// Records a ~3 minute captioned walkthrough of Bursar against a local, freshly seeded server.
// See scripts/walkthrough/README.md. Wipes the local database first; never point it at production.
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const OUT = process.argv[2];
const HERE = new URL(".", import.meta.url).pathname;
const TTS = process.env.TTS_DIR ?? `${HERE}tts`;
const B = "http://localhost:3000";
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fresh data: no founders yet, rates history in place.
execSync("npx tsx prisma/seed.ts", { cwd: new URL("../..", import.meta.url).pathname, stdio: "ignore" });
execSync(`node -e "const{PrismaClient}=require('@prisma/client');const d=new PrismaClient();(async()=>{await d.session.deleteMany();await d.ledgerEntry.deleteMany();await d.execution.deleteMany();await d.action.deleteMany();await d.cycle.deleteMany();await d.scheduledPayment.deleteMany();await d.payee.deleteMany();await d.walletSnapshot.deleteMany();await d.wallet.deleteMany();await d.webhookEvent.deleteMany();await d.auditLog.deleteMany();await d.policy.deleteMany();await d.company.deleteMany();await d.user.deleteMany();await d.mockTransaction.deleteMany();await d.mockWallet.deleteMany();await d.\\$disconnect()})()"`, { cwd: new URL("../..", import.meta.url).pathname, stdio: "ignore" });

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
const videoStart = Date.now();
const { readFileSync, writeFileSync } = await import("node:fs");
const timing = JSON.parse(readFileSync(`${TTS}/timing.json`, "utf8"));
const cues = [];
// Shows the caption, logs when this line starts on the video, and resolves when it has been spoken.
const say = (key) => {
  const text = timing.captions[key];
  cues.push({ key, at: (Date.now() - videoStart) / 1000 });
  page.evaluate((t) => {
    sessionStorage.setItem("demo-cap", t);
    const c = document.getElementById("demo-cap");
    if (c) { c.textContent = t; c.style.opacity = "1"; }
  }, text).catch(() => {});
  return sleep(timing.durations[key] * 1000 + 300);
};
const glide = async (loc, opts = {}) => {
  const box = await loc.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await sleep(opts.pause ?? 350);
};
const click = async (loc, opts) => { await loc.scrollIntoViewIfNeeded(); await glide(loc, opts); await loc.click(); };
const scrollBy = async (dy, steps = 12) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(60); } };
const toast = (re) => page.locator('[role="status"] span.flex-1').filter({ hasText: re }).first().waitFor({ timeout: 20000 });
let d;

// 1. Landing
await page.goto(B + "/", { waitUntil: "networkidle" });
await page.mouse.move(640, 360);
await sleep(600);
await say("intro");
await say("line");
d = say("how"); await scrollBy(780, 14); await d;
d = say("rules2"); await scrollBy(700, 14); await d;

// 2. Sign in
await page.goto(B + "/signin", { waitUntil: "networkidle" });
d = say("google"); await glide(page.getByRole("link", { name: "Continue with Google" })); await d;
await say("test");
await page.goto(B + "/auth/test-login?email=amaka%40gmail.com&name=Amaka%20Eze", { waitUntil: "networkidle" });

// 3. Onboarding
d = say("onboard");
await click(page.getByLabel("Company name"));
await page.getByLabel("Company name").pressSequentially("Kaduna Freight Ltd", { delay: 45 });
await d;
d = say("demo");
await click(page.getByLabel("Fill it with demo data"));
await page.getByLabel("Fill it with demo data").check();
await d;
await click(page.getByRole("button", { name: "Create company" }));
await page.waitForURL(B + "/app");
await say("setup");

// 4. Overview and a cycle
d = say("overview");
await glide(page.locator("svg[role=img]").first(), { pause: 300 });
for (let x = 0; x < 6; x++) { await page.mouse.move(450 + x * 90, 470, { steps: 6 }); await sleep(250); }
await d;
d = say("cycle");
await click(page.getByRole("button", { name: "Run cycle" }));
await toast(/Cycle/);
await d;
await say("result");

// 5. Approvals: the swap first, then the new vendor
await click(page.getByRole("link", { name: /Review 2 items/ }));
await page.waitForURL(/approvals/);
await click(page.getByRole("link", { name: /Rebalance NGN to USD/ }).first());
d = say("swap"); await scrollBy(560, 12); await d;
await scrollBy(450, 8);
await click(page.getByRole("button", { name: "Approve and run" }));
await toast(/Approved/);
await say("swap_ok");
await scrollBy(-1200, 6);
await click(page.getByRole("link", { name: /Pay Zaria Haulage/ }).first());
await say("approvals");
d = say("checks"); await scrollBy(560, 12); await d;
await scrollBy(450, 8);
await click(page.getByRole("button", { name: "Approve and run" }));
await toast(/Approved/);
await say("approved");

// 6. Activity
await click(page.getByRole("link", { name: "Activity" }).first());
await page.waitForURL(/activity/);
d = say("activity"); await scrollBy(520, 10); await d;

// 7. Excel
await scrollBy(-1200, 6);
const [download] = await Promise.all([page.waitForEvent("download"), click(page.getByRole("link", { name: "Export to Excel" }))]);
d = say("export");
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
execFileSync("node", [`${HERE}xlsx-preview.mjs`, file, `${OUT}/report.html`]);
await d;
await page.goto(`file://${OUT}/report.html`);
await say("x_summary");
for (const [tab, key] of [["Activity", "x_activity"], ["Payments", "x_payments"], ["Ledger", "x_ledger"], ["Wallets", "x_wallets"]]) {
  await click(page.locator(".tab", { hasText: tab }), { pause: 150 });
  await say(key);
}

// 8. Wallets
await page.goto(B + "/app/wallets?c=USD", { waitUntil: "networkidle" });
await say("wallets");
d = say("fund"); await scrollBy(800, 12); await sleep(600); await scrollBy(700, 12); await d;

// 9. Rules
await page.goto(B + "/app/rules", { waitUntil: "networkidle" });
await say("rulespage");

// 10. Second company
await page.goto(B + "/app", { waitUntil: "networkidle" });
d = say("multi");
await click(page.getByRole("button", { name: /Switch company$/ }));
await click(page.getByRole("link", { name: "+ Add a company" }));
await page.waitForURL(/companies\/new/);
await d;
await page.getByLabel("Company name").pressSequentially("Ilorin Agro Foods", { delay: 35 });
await click(page.getByRole("button", { name: "Create company" }));
await page.waitForURL(B + "/app");
await say("multi2");

// 11. Dark mode and close
await click(page.getByRole("radio", { name: "Dark" }).first());
d = say("dark");
await sleep(1200);
await page.goto(B + "/app/approvals", { waitUntil: "networkidle" });
await d;
await click(page.getByRole("radio", { name: "Light" }).first());
await page.goto(B + "/", { waitUntil: "networkidle" });
await say("outro");
await sleep(800);

writeFileSync(`${OUT}/cues.json`, JSON.stringify(cues, null, 1));
const video = page.video();
await ctx.close();
await browser.close();
console.log("VIDEO", await video.path(), "length", ((Date.now() - videoStart) / 1000).toFixed(1));
