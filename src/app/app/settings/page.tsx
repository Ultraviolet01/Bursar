import { headers } from "next/headers";
import { PageHeader, Pill, Row } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/dates";
import { sendTestWebhook } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<{ tested?: string }> }) {
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const lastHook = await db.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" } });
  const company = await db.company.findFirst();
  const configured = env.mode === "mock" || (!!env.clientId && !!env.clientSecret);

  return (
    <>
      <PageHeader title="Settings" subtitle="Blaaiz connection and webhooks" />
      {sp.tested && <div className="mb-6 rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-[15px] text-good">Test webhook signed, delivered and processed. See Activity, System log.</div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Blaaiz</h2>
          <div className="mt-3">
            <Row label="Mode" value={<Pill tone={env.mode === "mock" ? "amber" : "teal"}>{env.mode === "mock" ? "Mock" : "Live sandbox"}</Pill>} />
            <Row label="API" value={<span className="font-mono text-sm">{env.mode === "mock" ? "In-process mock" : env.apiUrl}</span>} />
            <Row label="Credentials" value={configured ? "Configured" : "Missing BLAAIZ_CLIENT_ID or secret"} tone={configured ? undefined : "amber"} />
            <Row label="Customer for payouts" value={<span className="font-mono text-sm">{company?.blaaizCustomerId ?? env.customerId}</span>} />
            <Row label="Webhook secret" value={env.webhookSecret ? "Set" : "Missing"} tone={env.webhookSecret ? undefined : "amber"} />
          </div>
          <p className="mt-4 text-sm text-muted">Switch modes with <code className="font-mono">BLAAIZ_MODE</code> in <code className="font-mono">.env</code> and restart. Engine code is identical in both modes.</p>
        </div>
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Webhooks</h2>
          <div className="mt-3">
            <Row label="Endpoint" value={<span className="break-all font-mono text-sm">{proto}://{host}/api/webhooks/blaaiz</span>} />
            <Row label="Signature" value={<span className="font-mono text-sm">x-blaaiz-signature + x-blaaiz-timestamp</span>} />
            <Row label="Last received" value={lastHook ? `${lastHook.eventType}, ${dateTime(lastHook.receivedAt)}` : "Never"} />
          </div>
          <p className="mt-4 text-sm text-muted">For the live sandbox, expose this URL with a tunnel (ngrok or cloudflared) and register it in the Blaaiz dev dashboard under API and Webhooks.</p>
          <form action={sendTestWebhook} className="mt-5"><button className="btn-outline">Send test webhook</button></form>
        </div>
      </div>
    </>
  );
}
