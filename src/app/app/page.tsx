import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { SubmitButton } from "@/components/interactive";
import { CountUp } from "@/components/interactive";
import { ForecastChart } from "@/components/forecast-chart";
import { IconCheck, IconLine } from "@/components/icons";
import { Amount, Empty, PageHeader, Pill, Row, SectionTitle, Tag, TextLink } from "@/components/ui";
import { db } from "@/lib/db";
import { getShell, getTreasury, runwayDays, walletHealth } from "@/lib/dashboard";
import { addDays, longToday, shortDate, timeAgo } from "@/lib/dates";
import { CURRENCIES, formatMinor, formatMoney } from "@/lib/money";
import { kindLabel, outcome, title } from "@/lib/view";
import { CATEGORY_LABEL } from "@/engine/types";
import { runCycleAction } from "./actions";

export default async function Overview() {
  const { company: active } = await requireCompany();
  const companyId = active.id;
  const [{ pending, lastCycle, mode, company }, t] = await Promise.all([getShell(companyId), getTreasury(companyId)]);
  const [proposals, recent, payees, rulesReviewed] = await Promise.all([
    db.action.findMany({ where: { companyId, status: "PENDING" }, orderBy: { number: "desc" }, take: 3 }),
    db.action.findMany({ where: { companyId, type: { not: "HOLD" } }, orderBy: { number: "desc" }, take: 5 }),
    db.payee.findMany({ where: { companyId }, select: { allowlisted: true, blaaizCustomerId: true } }),
    db.auditLog.count({ where: { companyId, message: "Updated rules" } }),
  ]);
  const payeeNames = new Map(t.payments.map((p) => [p.id, p.payee.name]));
  const extra = await db.scheduledPayment.findMany({
    where: { companyId, id: { in: [...proposals, ...recent].map((a) => a.paymentId).filter((x): x is string => !!x && !payeeNames.has(x)) } },
    include: { payee: true },
  });
  for (const p of extra) payeeNames.set(p.id, p.payee.name);

  const weekEnd = addDays(t.today, 6);
  const upcoming = t.payments.filter((p) => p.dueDate <= weekEnd).slice(0, 6);
  // Setup, in the lifecycle's order.
  const ngnWallet = t.wallets.find((w) => w.currency === "NGN");
  const foreign = t.currencies.filter((c) => c !== "NGN");
  const allowlisted = payees.filter((p) => p.allowlisted);
  const registered = allowlisted.filter((p) => p.blaaizCustomerId).length;
  const steps = [
    { done: !!company?.blaaizConnectedAt && t.currencies.length > 0, title: "Blaaiz wallets connected", sub: company?.blaaizConnectedAt ? `${t.currencies.join(", ")}, set up automatically` : "Bursar sets this up when you add the company; retry in Settings", href: "/app/settings" },
    { done: allowlisted.length > 0 && registered === allowlisted.length, title: "Register payees with Blaaiz", sub: allowlisted.length ? `${registered} of ${allowlisted.length} allowlisted payees are Blaaiz customers` : "Add employees and key vendors, then allowlist them", href: "/app/payees" },
    { done: !!ngnWallet?.vaAccountNumber && Number(ngnWallet.balance) > 0, title: "Fund NGN by bank transfer", sub: ngnWallet?.vaAccountNumber ? `${ngnWallet.vaBankName} ${ngnWallet.vaAccountNumber}` : "Create the NGN wallet's funding account", href: "/app/wallets?c=NGN" },
    { done: foreign.length > 0 && foreign.every((c) => t.fc[c].balance > 0), title: "Swap into your other currencies", sub: foreign.length ? foreign.map((c) => `${c} ${formatMinor(t.fc[c].balance, { decimals: false })}`).join(", ") : "Add a USD, EUR or GBP wallet first", href: `/app/wallets?c=${foreign[0] ?? "NGN"}` },
    { done: rulesReviewed > 0, title: "Set your hard rules", sub: "Buffers, daily cap, allowlisted payees, allowed pairs", href: "/app/rules" },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <>
      <PageHeader title="Overview" subtitle={`${longToday()}, ${pending === 0 ? "nothing needs you" : `${pending} item${pending > 1 ? "s" : ""} need${pending > 1 ? "" : "s"} you`}`}>
        <a href="/api/export" className="btn-outline" download>Export to Excel</a>
        <form action={runCycleAction}>
          <SubmitButton pendingText="Running cycle">Run cycle</SubmitButton>
        </form>
      </PageHeader>

      {!setupDone && (
        <section className="mb-6 grid gap-6 rounded-2xl border border-amber-line bg-amber-card p-6 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="display text-[26px] text-ink">Finish setting up {company?.name}</h2>
            <p className="mt-2 text-[15px] text-body">One-time setup. Until it is done, Bursar can still propose payments for you to approve.</p>
            <p className="mt-4 text-sm text-muted">{steps.filter((s) => s.done).length} of {steps.length} done</p>
          </div>
          <div className="divide-y divide-line rounded-xl bg-surface">
            {steps.map((s) => (
              <Link key={s.title} href={s.href} className="flex items-center gap-4 px-5 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-canvas">
                {s.done ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good text-surface"><IconCheck className="h-4 w-4" /></span>
                ) : (
                  <span className="h-6 w-6 rounded-full border-2 border-line" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-ink">{s.title}<span className="sr-only">{s.done ? ", done" : ", to do"}</span></div>
                  <div className="text-sm text-muted">{s.sub}</div>
                </div>
                {!s.done && <span className="text-sm text-teal" aria-hidden>Set up</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[15px] text-body">Total treasury</div>
              <div className="mt-2"><Amount minor={t.totalNgn} currency="NGN equiv." size="xl" decimals={false} animate /></div>
              <div className="mt-2 text-[15px] text-muted">
                {t.currencies.length} wallets on Blaaiz
                {t.currencies.filter((c) => c !== "NGN").map((c) => (
                  <span key={c}>, {c}/NGN <span className="num">{t.rates[c].toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 text-[15px] text-body">Projected balance, next {t.policy.horizonDays} days</div>
          <div className="mt-3">
            <ForecastChart points={[{ date: "now", label: "Now", value: t.totalNgn }, ...t.totalSeries.map((p) => ({ ...p, label: shortDate(p.date) }))]} buffer={t.bufferNgn} currency="NGN" />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t.payments.length ? `Includes ${t.payments.length} scheduled payment${t.payments.length > 1 ? "s" : ""} and estimated fees. Other currencies converted at today's rates.` : "No bills on file yet, so Bursar forecasts a flat balance."}
          </p>
        </div>

        <div className={`rounded-2xl border p-5 ${proposals.length ? "border-amber-line bg-amber-card" : "border-line bg-surface"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-medium text-ink">Needs you</h2>
            {pending > 0 && <span className="text-sm text-amber">{pending} open</span>}
          </div>
          {proposals.length ? (
            <>
              <div className="mt-4 space-y-3">
                {proposals.map((a) => {
                  const p = JSON.parse(a.payload) as { amount: number; currency: string };
                  return (
                    <Link key={a.id} href={`/app/approvals?id=${a.id}`} className="block rounded-xl bg-surface px-4 py-3.5 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-amber-line">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[15px] font-medium text-ink">{title(a, payeeNames.get(a.paymentId ?? ""))}</span>
                        <span className="num whitespace-nowrap text-sm text-body">{formatMoney(p.amount, p.currency, { decimals: false })}</span>
                      </div>
                      <div className="mt-1 text-sm text-muted">{kindLabel(a).label}</div>
                    </Link>
                  );
                })}
              </div>
              <Link href="/app/approvals" className="btn-primary mt-4 w-full">Review {pending} item{pending > 1 ? "s" : ""}</Link>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-muted">Nothing is waiting. Bursar will ask here when a payment is over your line.</p>
          )}
          <div className="mt-5 border-t border-line/80 pt-4 text-sm text-muted">
            <div className="font-medium text-body">Last cycle</div>
            {lastCycle ? (
              <p className="mt-1">
                {timeAgo(lastCycle.startedAt)}, {lastCycle.trigger.toLowerCase()}. {lastCycle.error ? <span className="text-bad">Failed: {lastCycle.error}</span> : lastCycle.summary}
              </p>
            ) : (
              <p className="mt-1">No cycle yet. Press Run cycle.</p>
            )}
          </div>
        </div>
      </section>

      <section className={`stagger mt-6 grid gap-6 md:grid-cols-2 ${t.currencies.length > 2 ? "2xl:grid-cols-4" : ""}`}>
        {t.currencies.map((c) => {
          const f = t.fc[c];
          const h = walletHealth(f);
          const w = t.wallets.find((x) => x.currency === c);
          return (
            <Link href={`/app/wallets?c=${c}`} key={c} className="card card-hover block p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[16px] font-medium text-ink">{c} wallet</div>
                  <div className="mt-0.5 font-mono text-[13px] text-faint">{w?.blaaizWalletId}</div>
                </div>
                <Tag>{c === "NGN" ? "Base" : `${t.rates[c].toLocaleString("en-US", { maximumFractionDigits: 0 })} NGN`}</Tag>
              </div>
              <div className="mt-5"><Amount minor={f.balance} currency={c} size="lg" animate /></div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-muted">Buffer</div><div className="num mt-0.5 text-ink">{formatMinor(f.buffer, { decimals: false })}</div></div>
                <div><div className="text-muted">Available</div><div className="num mt-0.5 text-ink">{formatMinor(Math.max(0, f.available), { decimals: false })}</div></div>
                <div><div className="text-muted">Due in {t.policy.horizonDays}d</div><div className="num mt-0.5 text-ink">{formatMinor(f.upcoming, { decimals: false })}</div></div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[15px] text-body">Runway: {runwayDays(f, t.today, t.policy.horizonDays)}</span>
                <Pill tone={h.tone}>{h.label}</Pill>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="card p-6">
          <SectionTitle title="Bursar's decisions" subtitle="Every move, with the rule it checked" right={<TextLink href="/app/activity">View all</TextLink>} />
          {recent.length ? (
            <div className="divide-y divide-line border-t border-line">
              {recent.map((a) => {
                const o = outcome(a);
                const p = JSON.parse(a.payload) as { amount: number; currency: string };
                return (
                  <div key={a.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Pill tone={o.tone}>{o.label}</Pill>
                      <span className="text-[15px] font-medium text-ink">{title(a, payeeNames.get(a.paymentId ?? ""))}</span>
                      <span className="num ml-auto text-[15px] text-ink">{formatMoney(p.amount, p.currency)}</span>
                      <span className="text-sm text-muted">{timeAgo(a.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-[15px] text-muted">{a.explanation}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>No decisions yet. Run a cycle to see what Bursar would do.</Empty>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <SectionTitle title="Upcoming payments" subtitle="Next 7 days" right={<TextLink href="/app/payments">All</TextLink>} />
            {upcoming.length ? (
              <div className="divide-y divide-line">
                {upcoming.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <div className="text-[15px] text-ink">{p.payee.name}</div>
                      <div className="text-sm text-muted">{p.dueDate <= t.today ? "Due today" : shortDate(p.dueDate)}, {CATEGORY_LABEL[p.payee.category].toLowerCase()}</div>
                    </div>
                    <div className="text-right">
                      <div className="num text-[15px] text-ink">{formatMoney(p.amount, p.currency, { decimals: false })}</div>
                      {p.status === "PROPOSED" && <div className="text-sm text-amber">Waiting for you</div>}
                      {p.status === "DEFERRED" && <div className="text-sm text-muted">Deferred</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No bills in the next 7 days.</Empty>
            )}
          </div>

          <div className="card p-6">
            <SectionTitle
              title="Active rules"
              right={<span className="text-sm text-muted">Checked before every move</span>}
            />
            <div className="-mt-2 mb-2 flex items-center gap-2 text-amber"><IconLine /><span className="text-sm">Your line</span></div>
            <Row label="Per payment" value={`${formatMoney(t.policy.perPaymentCap.NGN, "NGN", { decimals: false })} / ${formatMoney(t.policy.perPaymentCap.USD, "USD", { decimals: false })}`} />
            <Row label="Per day" value={formatMoney(t.policy.dailyCapNgn, "NGN", { decimals: false })} />
            <Row label="Per swap" value={formatMoney(t.policy.perSwapCapNgn, "NGN", { decimals: false })} />
            <Row label="Buffers" value={`${formatMoney(t.policy.buffer.NGN, "NGN", { decimals: false })} / ${formatMoney(t.policy.buffer.USD, "USD", { decimals: false })}`} />
            <Row label="New payees" value="Always need approval" />
            <Row label="Auto-execute" value={t.policy.autoExecute ? "On for routine" : "Off"} tone={t.policy.autoExecute ? undefined : "amber"} />
          </div>
        </div>
      </section>
    </>
  );
}
