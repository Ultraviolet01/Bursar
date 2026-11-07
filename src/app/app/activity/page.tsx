import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { getRates } from "@/lib/dashboard";
import { outcomes } from "@/engine/learn";
import type { Prisma } from "@prisma/client";
import { Amount, PageHeader, Pill, StatCard } from "@/components/ui";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/dates";
import { formatMinor, toNgn, type Currency } from "@/lib/money";
import { outcome, proof, reasonLabel, shortId, title } from "@/lib/view";
import type { ProposedAction } from "@/engine/types";

const TABS = [
  { key: "all", label: "All" },
  { key: "auto", label: "Auto" },
  { key: "approved", label: "Approved" },
  { key: "waiting", label: "Waiting" },
  { key: "deferred", label: "Deferred" },
  { key: "swaps", label: "Swaps" },
  { key: "held", label: "Held" },
  { key: "learned", label: "Suggestions" },
  { key: "failed", label: "Failed or rejected" },
  { key: "log", label: "System log" },
] as const;

const WHERE: Record<string, Prisma.ActionWhereInput> = {
  all: {},
  auto: { status: "EXECUTED", decidedBy: "BURSAR" },
  approved: { status: "EXECUTED", decidedBy: "OWNER" },
  waiting: { status: "PENDING" },
  deferred: { type: "DEFER" },
  swaps: { OR: [{ type: "SWAP" }, { type: "SWAP_THEN_PAY" }, { executions: { some: { kind: "SWAP" } } }] },
  held: { type: "HOLD" },
  learned: { type: "RULE_CHANGE" },
  failed: { status: { in: ["FAILED", "REJECTED"] } },
};

export default async function Activity({ searchParams }: { searchParams: Promise<{ tab?: string; limit?: string }> }) {
  const sp = await searchParams;
  const { company } = await requireCompany();
  const companyId = company.id;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "all";
  const limit = Math.min(500, Number(sp.limit) || 25);
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [{ rates }, recent30, total, rows, log, hooks, learned] = await Promise.all([
    getRates(),
    db.action.findMany({ where: { companyId, createdAt: { gte: since } } }),
    tab === "log" ? Promise.resolve(0) : db.action.count({ where: { companyId, ...WHERE[tab] } }),
    tab === "log" ? Promise.resolve([]) : db.action.findMany({ where: { companyId, ...WHERE[tab] }, orderBy: { number: "desc" }, take: limit, include: { executions: true } }),
    tab === "log" ? db.auditLog.findMany({ where: { companyId }, orderBy: { at: "desc" }, take: limit }) : Promise.resolve([]),
    tab === "log" ? db.webhookEvent.findMany({ where: { companyId }, orderBy: { receivedAt: "desc" }, take: 30 }) : Promise.resolve([]),
    outcomes(db, companyId),
  ]);
  const moved = recent30
    .filter((a) => a.status === "EXECUTED" && a.type !== "SWAP")
    .reduce((s, a) => {
      const p = JSON.parse(a.payload) as ProposedAction;
      return s + toNgn(p.amount, p.currency as Currency, rates);
    }, 0);
  const money = recent30.filter((a) => a.type !== "DEFER" && a.type !== "HOLD" && a.type !== "RULE_CHANGE");
  const alone = money.filter((a) => a.status === "EXECUTED" && a.decidedBy === "BURSAR").length;
  const waited = money.filter((a) => a.status === "PENDING" || a.decidedBy === "OWNER").length;
  const stillOpen = recent30.filter((a) => a.status === "PENDING").length;
  const deferred = recent30.filter((a) => a.type === "DEFER").length;

  const payIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
  const payees = new Map((await db.scheduledPayment.findMany({ where: { companyId, id: { in: payIds } }, include: { payee: true } })).map((p) => [p.id, p.payee.name]));

  return (
    <>
      <PageHeader title="Activity" subtitle="Every move, the rule it checked, and its Blaaiz reference">
        <a href="/api/export" className="btn-outline">Export CSV</a>
      </PageHeader>

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card"><StatCard label="Moved, last 30 days"><Amount minor={moved} currency="NGN equiv." size="md" decimals={false} /></StatCard></div>
        <div className="card">
          <StatCard label="Handled alone">
            <span className="flex items-baseline gap-2"><span className="display num text-[32px] text-ink">{alone} of {money.length}</span>{money.length > 0 && <span className="text-sm text-teal">{Math.round((alone / money.length) * 100)}%</span>}</span>
          </StatCard>
        </div>
        <div className="card">
          <StatCard label="Waited for you">
            <span className="flex items-baseline gap-2"><span className="display num text-[32px] text-ink">{waited}</span>{stillOpen > 0 && <span className="text-sm text-amber">{stillOpen} still open</span>}</span>
          </StatCard>
        </div>
        <div className="card">
          <StatCard label="Deferred">
            <span className="flex items-baseline gap-2"><span className="display num text-[32px] text-ink">{deferred}</span><span className="text-sm text-muted">non-critical, short on funds</span></span>
          </StatCard>
        </div>
      </div>

      <section className="card mt-6 p-6" aria-labelledby="learn-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="learn-title" className="text-[18px] text-ink">What Bursar learned, last 30 days</h2>
          <Link href="/app/activity?tab=learned" className="text-sm font-medium text-teal hover:underline">See suggestions</Link>
        </div>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <div>
            <div className="text-sm text-muted">Your decisions</div>
            <p className="mt-1 text-[15px] text-ink">
              {learned.decided ? `You approved ${learned.approved} of ${learned.decided} proposals and rejected ${learned.rejected}.` : "No proposals decided yet."}
            </p>
            {learned.byReason.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-body">
                {learned.byReason.slice(0, 4).map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3"><span>{reasonLabel(r.reason)}</span><span className="num text-muted">{r.approved} approved, {r.rejected} rejected</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-sm text-muted">Rate conditions</div>
            <p className="mt-1 text-[15px] text-ink">
              {learned.swaps.count === 0
                ? "No swaps yet."
                : learned.swaps.avgVsAveragePct === null
                  ? `${learned.swaps.count} swaps, no rate history to compare.`
                  : `${learned.swaps.count} swap${learned.swaps.count > 1 ? "s" : ""}, on average ${Math.abs(learned.swaps.avgVsAveragePct).toFixed(2)}% ${learned.swaps.avgVsAveragePct <= 0 ? "better" : "worse"} than the 7-day average.`}
            </p>
            <p className="mt-2 text-sm text-muted">Bursar skips swaps more than your rate band worse than average and defers bills that can wait.</p>
          </div>
          <div>
            <div className="text-sm text-muted">Deferred bills</div>
            <p className="mt-1 text-[15px] text-ink">
              {learned.deferred ? `${learned.deferred} deferred, ${learned.deferredLaterPaid} since paid.` : "Nothing deferred."}
            </p>
            <p className="mt-2 text-sm text-muted">Repeated approvals turn into rule suggestions you can accept in Approvals.</p>
          </div>
        </div>
      </section>

      <div className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-canvas p-1">
            {TABS.map((t) => (
              <Link key={t.key} href={`/app/activity?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className={`tab shrink-0 ${tab === t.key ? "tab-active" : ""}`}>{t.label}</Link>
            ))}
          </div>
          <span className="text-sm text-muted">All wallets, all time</span>
        </div>

        {tab === "log" ? (
          <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
            <div className="divide-y divide-line">
              {log.map((l) => (
                <div key={l.id} className="flex gap-4 px-5 py-3 text-[15px]">
                  <span className="w-[110px] shrink-0 text-muted">{dateTime(l.at)}</span>
                  <Pill tone={l.actor === "OWNER" ? "teal" : l.actor === "BLAAIZ" ? "grey" : "good"} dot={false}>{l.actor === "BURSAR" ? "Bursar" : l.actor === "OWNER" ? "You" : "Blaaiz"}</Pill>
                  <span className="text-body">{l.message}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-line lg:border-l lg:border-t-0">
              <div className="px-5 py-3 text-[15px] font-medium text-ink">Webhooks received</div>
              <div className="divide-y divide-line">
                {hooks.length === 0 && <div className="px-5 py-3 text-sm text-muted">None yet.</div>}
                {hooks.map((h) => (
                  <div key={h.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-ink">{h.eventType}</span>
                      <Pill tone={h.signatureValid ? "good" : "bad"}>{h.signatureValid ? "Signed" : "Rejected"}</Pill>
                    </div>
                    <div className="mt-1 text-muted">{dateTime(h.receivedAt)}{h.note ? `, ${h.note}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="md:overflow-x-auto">
              <table className="block w-full text-left text-[15px] md:table md:min-w-[980px]">
                <caption className="sr-only">Bursar actions for {company.name}</caption>
                <thead className="hidden bg-canvas/60 text-muted md:table-header-group">
                  <tr>
                    {["When", "What happened", "Wallet", "Amount", "Outcome", "Rule checked", "Blaaiz ref"].map((h) => (
                      <th key={h} scope="col" className={`px-5 py-3 font-normal ${h === "Amount" ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="block divide-y divide-line md:table-row-group">
                  {rows.map((a) => {
                    const p = JSON.parse(a.payload) as ProposedAction;
                    const o = outcome(a);
                    const ref = proof(a);
                    const out = a.status === "EXECUTED" && a.type !== "SWAP";
                    return (
                      <tr key={a.id} className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-4 align-top transition-colors hover:bg-canvas/60 md:table-row md:p-0">
                        <td data-label="When" className="block md:table-cell whitespace-nowrap md:px-5 md:py-4 text-muted before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">{dateTime(a.createdAt)}</td>
                        <td data-label="What happened" className="block col-span-2 md:table-cell md:px-5 md:py-4 before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">
                          <Link href={a.status === "PENDING" || a.decidedBy === "OWNER" ? `/app/approvals?id=${a.id}` : "#"} className="text-ink">{title(a, payees.get(a.paymentId ?? ""))}</Link>
                          <div className="mt-1 max-w-[340px] text-sm text-muted">{a.explanation}</div>
                        </td>
                        <td data-label="Wallet" className="block md:table-cell whitespace-nowrap md:px-5 md:py-4 text-body before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">{p.swap && a.type !== "PAY" ? `${p.swap.from} to ${p.swap.to}` : `${p.currency} wallet`}</td>
                        <td data-label="Amount" className="block md:table-cell num whitespace-nowrap md:px-5 md:py-4 text-right text-ink before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">{out ? "-" : ""}{formatMinor(p.amount)} <span className="text-faint">{p.currency}</span></td>
                        <td data-label="Outcome" className="block md:table-cell md:px-5 md:py-4 before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden"><Pill tone={o.tone}>{o.label}</Pill></td>
                        <td data-label="Rule checked" className="block md:table-cell md:px-5 md:py-4 text-body before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">{a.reasonCode === "ROUTINE_OK" ? "Within all rules" : reasonLabel(a.reasonCode)}</td>
                        <td data-label="Blaaiz ref" className="block md:table-cell whitespace-nowrap md:px-5 md:py-4 before:mb-0.5 before:block before:text-xs before:uppercase before:tracking-wide before:text-muted before:content-[attr(data-label)] md:before:hidden">
                          {ref ? <span className="font-mono text-[14px] text-teal" title={ref}>{shortId(ref)}</span> : <span className="text-faint">None</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr className="block md:table-row"><td colSpan={7} className="px-5 py-10 text-center text-muted">Nothing here yet. Run a cycle from the Overview.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <span className="text-sm text-muted">Showing {rows.length} of {total}</span>
              {rows.length < total && <Link href={`/app/activity?tab=${tab}&limit=${limit + 25}`} className="btn-outline">Load more</Link>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
