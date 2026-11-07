// Automatic Blaaiz setup for a company. Runs when the founder adds a company and
// from Settings ("Reconnect"). Every step is safe to repeat.
//   1. Discover the business's wallets (Blaaiz creates wallets with the business
//      account; its API has no endpoint to create them) and save them.
//   2. Read rates so the forecast and swaps have prices from the first minute.
//   3. Create the NGN wallet's funding account (virtual bank account) if missing.
//   4. Register Bursar's webhook URL with Blaaiz (live mode, public https URL only).
import type { PrismaClient } from "@prisma/client";
import { forgetBlaaiz, getBlaaiz } from "./index";
import { loadMarket, syncWallets } from "../engine/observe";
import { CURRENCIES } from "../lib/money";
import { audit } from "../lib/repo";

export interface ConnectStep {
  step: string;
  ok: boolean;
  detail: string;
}

export async function connectBlaaiz(db: PrismaClient, companyId: string, baseUrl?: string | null): Promise<{ ok: boolean; steps: ConnectStep[] }> {
  forgetBlaaiz(companyId);
  const steps: ConnectStep[] = [];
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  let client;
  try {
    client = await getBlaaiz(companyId);
  } catch (e) {
    steps.push({ step: "Credentials", ok: false, detail: String(e instanceof Error ? e.message : e) });
    return finish(db, companyId, steps);
  }

  try {
    const wallets = await syncWallets(db, client, companyId);
    if (!wallets.length) throw new Error("Blaaiz returned no NGN, USD, EUR or GBP wallets for this business");
    const held = CURRENCIES.filter((c) => wallets.some((w) => w.currency === c));
    await db.company.update({ where: { id: companyId }, data: { currencies: held.join(",") } });
    steps.push({ step: "Wallets", ok: true, detail: `Found ${held.join(", ")}` });
  } catch (e) {
    steps.push({ step: "Wallets", ok: false, detail: String(e instanceof Error ? e.message : e) });
    return finish(db, companyId, steps);
  }

  try {
    const m = await loadMarket(db, client, true);
    steps.push({ step: "Rates", ok: true, detail: CURRENCIES.filter((c) => c !== "NGN").map((c) => `${c} ${m.rates[c]}`).join(", ") });
  } catch (e) {
    steps.push({ step: "Rates", ok: false, detail: String(e instanceof Error ? e.message : e) });
  }

  const ngn = await db.wallet.findUnique({ where: { companyId_currency: { companyId, currency: "NGN" } } });
  if (ngn && !ngn.vaAccountNumber) {
    try {
      const va = await client.createVirtualAccount(ngn.blaaizWalletId, company.name);
      await db.wallet.update({ where: { id: ngn.id }, data: { vaAccountNumber: va.accountNumber, vaAccountName: va.accountName, vaBankName: va.bankName } });
      steps.push({ step: "Funding account", ok: true, detail: `${va.bankName} ${va.accountNumber}` });
    } catch (e) {
      steps.push({ step: "Funding account", ok: false, detail: String(e instanceof Error ? e.message : e) });
    }
  } else if (ngn?.vaAccountNumber) {
    steps.push({ step: "Funding account", ok: true, detail: `${ngn.vaBankName} ${ngn.vaAccountNumber}` });
  }

  if (client.mode === "live") {
    const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/webhooks/blaaiz/${companyId}` : null;
    if (url?.startsWith("https://")) {
      try {
        await client.registerWebhooks(url);
        steps.push({ step: "Webhooks", ok: true, detail: `Registered ${url}` });
      } catch (e) {
        steps.push({ step: "Webhooks", ok: false, detail: String(e instanceof Error ? e.message : e) });
      }
    } else {
      steps.push({ step: "Webhooks", ok: false, detail: "Needs a public https address (set APP_URL); register it in the Blaaiz dashboard meanwhile" });
    }
  } else {
    steps.push({ step: "Webhooks", ok: true, detail: "Mock mode delivers webhooks in-process" });
  }

  return finish(db, companyId, steps);
}

async function finish(db: PrismaClient, companyId: string, steps: ConnectStep[]) {
  const ok = steps.every((s) => s.ok);
  const note = steps.map((s) => `${s.ok ? "OK" : "FAILED"} ${s.step}: ${s.detail}`).join("\n");
  await db.company.update({ where: { id: companyId }, data: { blaaizConnectedAt: ok ? new Date() : null, blaaizConnectNote: note } });
  await audit(db, companyId, "BURSAR", `Blaaiz setup ${ok ? "complete" : "needs attention"}: ${steps.map((s) => `${s.step} ${s.ok ? "ok" : "failed"}`).join(", ")}`, "Company", companyId);
  return { ok, steps };
}
