import Link from "next/link";
import { Amount, PageHeader, Pill, Row, StatCard, Tag, TextLink } from "@/components/ui";
import { db } from "@/lib/db";
import { getTreasury, runwayDays, walletHealth } from "@/lib/dashboard";
import { shortDate } from "@/lib/dates";
import { CURRENCIES, type Currency, formatMinor, formatMoney, toNgn } from "@/lib/money";
import { MockBlaaizClient } from "@/blaaiz/mock";
import { getBlaaiz } from "@/blaaiz";
import { runCycleAction, simulateDeposit } from "../actions";

export default async function Wallets({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const sel: Currency = sp.c === "USD" ? "USD" : "NGN";
  const t = await getTreasury();
  const topUps = await db.action.findMany({ where: { type: "SWAP", status: "PENDING" } });
  const avgRows = await db.rateSnapshot.findMany({ where: { fetchedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { rate: true } });
  const avg = avgRows.length ? avgRows.reduce((s, r) => s + r.rate, 0) / avgRows.length : t.usdNgn;
  const shortfalls = CURRENCIES.filter((c) => t.fc[c].belowBufferOn);
  const aboveBuffers = CURRENCIES.reduce((s, c) => s + toNgn(Math.max(0, t.fc[c].balance - t.fc[c].buffer), c, t.usdNgn), 0);
  const heldNgn = CURRENCIES.reduce((s, c) => s + toNgn(t.fc[c].buffer, c, t.usdNgn), 0);
  const f = t.fc[sel];
  const wallet = t.wallets.find((w) => w.currency === sel);
  const topUp = topUps.find((a) => (JSON.parse(a.payload) as { currency: string }).currency === sel);
  const mock = getBlaaiz() instanceof MockBlaaizClient;
  const other: Currency = sel === "NGN" ? "USD" : "NGN";

  return (
    <>
      <PageHeader title="Wallets" subtitle="Bursar keeps each wallet above its buffer" />

      <div className="card grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        <StatCard label="Total across wallets" foot="NGN and USD on Blaaiz"><Amount minor={t.totalNgn} currency="NGN equiv." size="md" decimals={false} /></StatCard>
        <StatCard label="Above buffers" foot={`${formatMoney(heldNgn, "NGN", { decimals: false })} held back as buffers`}><Amount minor={aboveBuffers} currency="NGN equiv." size="md" decimals={false} /></StatCard>
        <StatCard label="Shortfalls ahead" foot={shortfalls.length ? shortfalls.map((c) => `${c} on ${shortDate(t.fc[c].belowBufferOn!)}`).join(", ") : `None in the next ${t.policy.horizonDays} days`} footTone={shortfalls.length ? "amber" : "muted"}>
          <span className="display num text-[32px] text-ink">{shortfalls.length}</span>
        </StatCard>
        <StatCard label="USD/NGN today" foot={`7-day average ${avg.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}>
          <span className="display num text-[32px] text-ink">{t.usdNgn.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
        </StatCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,1fr)_1.6fr]">
        <div className="space-y-4">
          {CURRENCIES.map((c) => {
            const fc = t.fc[c];
            const h = walletHealth(fc);
            const w = t.wallets.find((x) => x.currency === c);
            return (
              <Link key={c} href={`/app/wallets?c=${c}`} className={`block rounded-2xl border p-6 ${c === sel ? "border-teal bg-teal-soft" : "border-line bg-surface hover:border-faint"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[17px] text-ink">{c} wallet</div>
                    <div className="mt-0.5 font-mono text-[13px] text-faint">{w?.blaaizWalletId}</div>
                  </div>
                  <Tag>Blaaiz</Tag>
                </div>
                <div className="mt-5"><Amount minor={fc.balance} currency={c} size="md" /></div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[15px] text-body">Buffer {formatMinor(fc.buffer, { decimals: false })}, {runwayDays(fc, t.today, t.policy.horizonDays)}</span>
                  <Pill tone={h.tone}>{h.label}</Pill>
                </div>
              </Link>
            );
          })}
          {mock && (
            <form action={simulateDeposit} className="card p-5">
              <div className="text-[15px] font-medium text-ink">Simulate a deposit</div>
              <p className="mt-1 text-sm text-muted">Mock only. Fires a signed collection.completed webhook.</p>
              <div className="mt-3 flex gap-2">
                <select name="currency" className="input w-24" defaultValue={sel}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input name="amount" className="input" placeholder="Amount" defaultValue={sel === "NGN" ? "1000000" : "500"} />
                <button className="btn-outline shrink-0">Deposit</button>
              </div>
            </form>
          )}
        </div>

        <div className="card p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3"><span className="text-[26px] text-ink">{sel} wallet</span><Tag>Blaaiz</Tag></div>
              <div className="mt-1 font-mono text-[14px] text-faint">{wallet?.blaaizWalletId}</div>
            </div>
          </div>
          <div className="mt-4"><Amount minor={f.balance} currency={sel} size="xl" /></div>

          <div className="mt-8 flex items-center justify-between">
            <h3 className="text-[18px] text-ink">Next {t.policy.horizonDays} days</h3>
            <span className="text-sm text-muted">Balance after</span>
          </div>
          <div className="mt-3 divide-y divide-line border-t border-line text-[15px]">
            <div className="grid grid-cols-[80px_1fr_auto] gap-4 py-4 sm:grid-cols-[90px_1fr_140px_140px]">
              <span className="text-muted">Today</span><span className="text-ink">Current balance</span><span className="hidden sm:block" />
              <span className="num text-right text-ink">{formatMinor(f.balance)}</span>
            </div>
            {f.steps.map((s) => {
              const below = s.balanceAfter < f.buffer;
              return (
                <div key={s.id} className="grid grid-cols-[80px_1fr_auto] gap-4 py-4 sm:grid-cols-[90px_1fr_140px_140px]">
                  <span className="text-muted">{s.date <= t.today ? "Due" : shortDate(s.date)}</span>
                  <span className="text-ink">{s.label}</span>
                  <span className="num hidden text-right text-body sm:block">-{formatMinor(s.amount)}</span>
                  <span className={`num text-right ${below ? "text-amber" : "text-ink"}`}>{formatMinor(s.balanceAfter)}</span>
                </div>
              );
            })}
            {f.steps.length === 0 && <div className="py-4 text-muted">No {sel} payments in the horizon.</div>}
          </div>

          {f.belowBufferOn && (
            <div className="mt-6 flex flex-col gap-4 rounded-xl bg-amber-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[16px] text-ink">{sel} drops below its buffer on {shortDate(f.belowBufferOn)}</div>
                <div className="mt-1 text-[15px] text-body">
                  {topUp ? `Top-up #${topUp.number} from ${other} would keep it above ${formatMoney(f.buffer, sel, { decimals: false })}.` : `Next cycle will pay what it can and propose a top-up from ${other}.`}
                </div>
              </div>
              {topUp ? (
                <Link href={`/app/approvals?id=${topUp.id}`} className="btn-primary shrink-0">Review #{topUp.number}</Link>
              ) : (
                <form action={runCycleAction}><button className="btn-primary shrink-0">Run cycle</button></form>
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <h3 className="text-[18px] text-ink">Rules for this wallet</h3>
            <TextLink href="/app/rules">Edit in Rules</TextLink>
          </div>
          <div className="mt-3 border-t border-line">
            <Row label="Buffer" value={formatMoney(t.policy.buffer[sel], sel, { decimals: false })} />
            <Row label="Per payment" value={formatMoney(t.policy.perPaymentCap[sel], sel, { decimals: false })} />
            <Row label="Tops up from" value={t.policy.allowedPairs.includes(`${other}>${sel}`) ? `${other} wallet` : "Not allowed"} />
            <Row label="Pays out to" value={[...new Set(t.payments.filter((p) => p.currency === sel).map((p) => p.payee.name))].slice(0, 3).join(", ") || "Nobody scheduled"} />
          </div>
        </div>
      </div>
    </>
  );
}
