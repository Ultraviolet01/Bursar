// Dev inbox. Shows emails Bursar would have sent when no email provider is configured.
// Never available when RESEND_API_KEY is set, and off in production unless ENABLE_DEV_MAIL=1.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { devMailEnabled } from "@/lib/email";
import { dateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Dev inbox | Bursar" };
export const dynamic = "force-dynamic";

export default async function DevMail() {
  if (!devMailEnabled()) notFound();
  const mail = await db.devEmail.findMany({ orderBy: { sentAt: "desc" }, take: 30 });
  return (
    <main id="main" className="mx-auto max-w-[760px] px-4 py-12">
      <Link href="/" className="display text-[22px] tracking-[0.08em] text-ink">BURSAR</Link>
      <h1 className="display mt-6 text-[40px] text-ink">Dev inbox</h1>
      <p className="mt-2 text-[15px] text-muted">
        No email provider is configured, so emails land here instead. Set <code className="font-mono">RESEND_API_KEY</code> and <code className="font-mono">EMAIL_FROM</code> to send real email.
      </p>
      <ul className="mt-8 space-y-3">
        {mail.length === 0 && <li className="card p-5 text-muted">Nothing sent yet.</li>}
        {mail.map((m) => (
          <li key={m.id} className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[16px] font-medium text-ink">{m.subject}</span>
              <span className="text-sm text-muted">{dateTime(m.sentAt)}</span>
            </div>
            <div className="mt-1 text-sm text-muted">To {m.to}</div>
            <p className="mt-3 whitespace-pre-line text-[15px] text-body">{m.text}</p>
            {m.link && <a href={m.link} className="btn-primary mt-4">Open link</a>}
          </li>
        ))}
      </ul>
    </main>
  );
}
