import { headers } from "next/headers";
import Link from "next/link";
import { SubmitButton } from "@/components/interactive";
import { PageHeader, Pill, Row } from "@/components/ui";
import { requireCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/dates";
import { reconnectBlaaiz, saveAccount, saveCompanySettings, sendTestWebhook } from "../actions";
import { getBlaaiz } from "@/blaaiz";
import type { DiagnosticCheck } from "@/blaaiz/client";
import { googleEnabled } from "@/lib/google";

export default async function Settings({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const { check } = await searchParams;
  const { company, companies, user } = await requireCompany();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const lastHook = await db.webhookEvent.findFirst({ where: { companyId: company.id }, orderBy: { receivedAt: "desc" } });
  const live = env.mode === "live";
  const hasKey = (process.env.BURSAR_SECRET_KEY ?? "").length >= 32;
  let checks: DiagnosticCheck[] | null = null;
  if (check === "1") {
    try {
      checks = await (await getBlaaiz(company.id)).diagnose();
    } catch (e) {
      checks = [{ name: "Connection", ok: false, detail: String(e instanceof Error ? e.message : e) }];
    }
  }
  const configured = !live || (!!(company.blaaizClientId || env.clientId) && !!(company.blaaizClientSecretEnc || env.clientSecret));

  return (
    <>
      <PageHeader title="Settings" subtitle={`${company.name}: Blaaiz connection and webhooks`} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Blaaiz</h2>
          <div className="mt-3">
            <Row label="Mode" value={<Pill tone={live ? "teal" : "amber"}>{live ? "Live sandbox" : "Mock"}</Pill>} />
            <Row label="API" value={<span className="font-mono text-sm">{live ? env.apiUrl : "In-process mock"}</span>} />
            <Row label="Credentials" value={configured ? "Configured" : "Missing client ID or secret"} tone={configured ? undefined : "amber"} />
            <Row label="Customer for payouts" value={<span className="font-mono text-sm">{company.blaaizCustomerId ?? "Not set"}</span>} />
          </div>
          <p className="mt-4 text-sm text-muted">Switch modes with <code className="font-mono">BLAAIZ_MODE</code> in <code className="font-mono">.env</code> and restart. Engine code is identical in both modes.</p>
        </div>

        <div className="card p-6 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px] text-ink">Blaaiz setup</h2>
            <div className="flex flex-wrap gap-2">
              <form action={reconnectBlaaiz}><SubmitButton className="btn-outline btn-sm" pendingText="Setting up">Run Blaaiz setup again</SubmitButton></form>
              <a href="/app/settings?check=1" className="btn-outline btn-sm">Test Blaaiz connection</a>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">Runs automatically when a company is added: finds the business&apos;s wallets, creates the NGN funding account and registers Bursar&apos;s webhook. Blaaiz creates wallets with the business account; its API cannot create them.</p>
          {company.blaaizConnectNote ? (
            <ul className="mt-4 space-y-1.5 text-[15px]">
              {company.blaaizConnectNote.split("\n").map((line) => {
                const ok = line.startsWith("OK ");
                return (
                  <li key={line} className="flex gap-2 [overflow-wrap:anywhere]">
                    <Pill tone={ok ? "good" : "amber"}>{ok ? "Done" : "Needs attention"}</Pill>
                    <span className="text-body">{line.replace(/^(OK|FAILED) /, "")}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-[15px] text-muted">Not run yet for this company.</p>
          )}
          {checks && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="text-[15px] font-medium text-ink">Connection test {checks.every((c) => c.ok) ? "passed" : "found problems"}</div>
              <p className="text-sm text-muted">Read-only calls. Nothing is paid or swapped.</p>
              <ul className="mt-3 divide-y divide-line">
                {checks.map((c) => (
                  <li key={c.name} className="py-2.5 text-[15px] [overflow-wrap:anywhere]">
                    <div className="flex items-center gap-2"><Pill tone={c.ok ? "good" : "bad"}>{c.ok ? "Pass" : "Fail"}</Pill><span className="text-ink">{c.name}</span></div>
                    <div className="mt-1 text-sm text-body">{c.detail}</div>
                    {c.fields && c.fields.length > 0 && <div className="mt-0.5 font-mono text-xs text-muted">fields: {c.fields.join(", ")}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Webhooks</h2>
          <div className="mt-3">
            <Row label="Endpoint for this company" value={<span className="break-all font-mono text-sm">{proto}://{host}/api/webhooks/blaaiz/{company.id}</span>} />
            <Row label="Signature" value={<span className="font-mono text-sm">x-blaaiz-signature + x-blaaiz-timestamp</span>} />
            <Row label="Last received" value={lastHook ? `${lastHook.eventType}, ${dateTime(lastHook.receivedAt)}` : "Never"} />
          </div>
          <p className="mt-4 text-sm text-muted">Each company gets its own URL, so each Blaaiz business signs with its own secret. Expose it with a tunnel and register it in that business&apos;s Blaaiz dev dashboard.</p>
          <form action={sendTestWebhook} className="mt-5"><SubmitButton className="btn-outline" pendingText="Sending">Send test webhook</SubmitButton></form>
        </div>

        <form action={saveCompanySettings} className="card space-y-4 p-6">
          <h2 className="text-[18px] text-ink">Company</h2>
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" defaultValue={company.name} required minLength={2} className="input" />
          </div>
          {live && (
            <>
              <div>
                <label htmlFor="blaaizCustomerId" className="label">Blaaiz customer ID (used on payouts)</label>
                <input id="blaaizCustomerId" name="blaaizCustomerId" defaultValue={company.blaaizCustomerId ?? ""} className="input font-mono" />
              </div>
              <div>
                <label htmlFor="blaaizClientId" className="label">OAuth client ID</label>
                <input id="blaaizClientId" name="blaaizClientId" defaultValue={company.blaaizClientId ?? ""} className="input font-mono" autoComplete="off" />
              </div>
              <fieldset disabled={!hasKey} className="space-y-4 disabled:opacity-60">
                <div>
                  <label htmlFor="blaaizClientSecret" className="label">OAuth client secret {company.blaaizClientSecretEnc && <span className="text-good">(stored, encrypted)</span>}</label>
                  <input id="blaaizClientSecret" name="blaaizClientSecret" type="password" placeholder="Leave blank to keep" className="input font-mono" autoComplete="new-password" />
                </div>
                <div>
                  <label htmlFor="blaaizWebhookSecret" className="label">Webhook signing secret {company.blaaizWebhookSecretEnc && <span className="text-good">(stored, encrypted)</span>}</label>
                  <input id="blaaizWebhookSecret" name="blaaizWebhookSecret" type="password" placeholder="Leave blank to keep" className="input font-mono" autoComplete="new-password" />
                </div>
              </fieldset>
              {!hasKey && <p className="text-sm text-amber">Set BURSAR_SECRET_KEY (32+ characters) to store secrets. They are encrypted with AES-256-GCM and never shown again.</p>}
            </>
          )}
          <SubmitButton pendingText="Saving">Save</SubmitButton>
        </form>

        <div className="card space-y-5 p-6">
          <h2 className="text-[18px] text-ink">Your account</h2>
          <div>
            <Row label="Email" value={user.email} />
            <Row label="Signs in with" value={user.googleSub ? "Google" : googleEnabled() ? "Google (linked on next sign-in)" : "Test sign-in"} />
          </div>
          <form action={saveAccount} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="acct-name" className="label">Name</label>
              <input id="acct-name" name="name" defaultValue={user.name} required minLength={2} className="input" autoComplete="name" />
            </div>
            <SubmitButton className="btn-outline" pendingText="Saving">Save</SubmitButton>
          </form>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] text-ink">Your companies</h2>
            <Link href="/app/companies/new" className="btn-outline btn-sm">Add a company</Link>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3 text-[15px]">
                <span className="text-ink">{c.name}</span>
                {c.id === company.id ? <Pill tone="teal">Current</Pill> : <span className="text-sm text-muted">Switch from the sidebar</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
