import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { SubmitButton } from "@/components/interactive";
import { Amount, PageHeader, Pill, Row, StatCard, Tag, TextLink } from "@/components/ui";
import { db } from "@/lib/db";
import { getTreasury, runwayDays, walletHealth } from "@/lib/dashboard";
import { dateTime, shortDate } from "@/lib/dates";
import { bn, CURRENCIES, type Currency, CURRENCY_NAME, formatMinor, formatMoney, formatRate, toNgn } from "@/lib/money";
import { MockBlaaizClient } from "@/blaaiz/mock";
import { getBlaaiz } from "@/blaaiz";
import { addWallet, convertCurrency, createVirtualAccountAction, runCycleAction, simulateDeposit } from "../actions";

const LEDGER_LABEL: Record<string, string> = { PAYOUT: "Payout", FEE: "Fee", SWAP_OUT: "Swap out", SWAP_IN: "Swap in", DEPOSIT: "Deposit", REFUND: "Refund" };

export default async function Wallets({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const sp = await searchParams;
  const { company } = await requireCompany();
  const t = await getTreasury(company.id);
  const held = t.currencies;
  const sel: Currency = held.includes(sp.c as Currency) ? (sp.c as Currency) : held[0];
  const [swapsWaiting, ledger] = await Promise.all([
    db.action.findMany({ where: { companyId: company.id, type: "SWAP", status: "PENDING" } }),
    db.ledgerEntry.findMany({ where: { companyId: company.id, currency: sel }, orderBy: { at: "desc" }, take: 12 }),
  ]);
  const mock = (await getBlaaiz(company.id)) instanceof MockBlaaizClient;
  const shortfalls = held.filter((c) => t.fc[c].belowBufferOn);
  const aboveBuffers = held.reduce((s, c) => s + toNgn(Math.max(0, t.fc[c].balance - t.fc[c].buffer), c, t.rates), 0);
  const heldNgn = held.reduce((s, c) => s + toNgn(t.fc[c].buffer, c, t.rates), 0);
  const f = t.fc[sel];
  const wallet = t.wallets.find((w) => w.currency === sel)!;
  const waiting = swapsWaiting.find((a) => (JSON.parse(a.payload) as { currency: string }).currency === sel);
  const sources = held.filter((c) => c !== sel && t.policy.allowedPairs.includes(`${c}>${sel}`));
  const missing = CURRENCIES.filter((c) => !held.includes(c));
  const foreign = held.filter((c) => c !== "NGN");

  return (
    <>
      <PageHeader title="Wallets" subtitle="Bursar keeps each wallet above its buffer, rebalancing between your own wallets when one runs short">
        {missing.length > 0 && (
          <form action={addWallet} className="flex gap-2">
            <label htmlFor="add-cur" className="sr-only">Currency to add</label>
            <select id="add-cur" name="currency" className="input w-28">
              {missing.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <SubmitButton className="btn-outline shrink-0" pendingText="Adding">Add wallet</SubmitButton>
          </form>
        )}
      </PageHeader>

      <div className="card stagger grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        <StatCard label="Total across wallets" foot={held.join(", ") + " on Blaaiz"}><Amount minor={t.totalNgn} currency="NGN equiv." size="md" decimals={false} animate /></StatCard>
        <StatCard label="Above buffers" foot={`${formatMoney(heldNgn, "NGN", { decimals: false })} held back as buffers`}><Amount minor={aboveBuffers} currency="NGN equiv." size="md" decimals={false} animate /></StatCard>
        <StatCard label="Shortfalls ahead" foot={shortfalls.length ? shortfalls.map((c) => `${c} on ${shortDate(t.fc[c].belowBufferOn!)}`).join(", ") : `None in the next ${t.policy.horizonDays} days`} footTone={shortfalls.length ? "amber" : "muted"}>
          <span className="display num text-[32px] text-ink">{shortfalls.length}</span>
        </StatCard>
        <StatCard label="Rates today" foot="NGN per unit, 7-day average in brackets">
          <div className="space-y-0.5 text-[15px]">
            {(foreign.length ? foreign : (["USD"] as Currency[])).map((c) => (
              <div key={c} className="num text-ink">
                {c} <span className="font-medium">{t.rates[c].toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> <span className="text-muted">({t.avg7d[c].toLocaleString("en-US", { maximumFractionDigits: 2 })})</span>
              </div>
            ))}
          </div>
        </StatCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,1fr)_1.6fr]">
        <div className="space-y-4">
          {held.map((c) => {
            const fc = t.fc[c];
            const h = walletHealth(fc);
            const w = t.wallets.find((x) => x.currency === c);
            return (
              <Link key={c} href={`/app/wallets?c=${c}`} aria-current={c === sel ? "true" : undefined} className={`block rounded-2xl border p-6 transition-all duration-200 ${c === sel ? "border-teal bg-teal-soft shadow-sm" : "border-line bg-surface hover:-translate-y-0.5 hover:border-strong hover:shadow-md"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[17px] text-ink">{c} wallet</div>
                    <div className="mt-0.5 font-mono text-[13px] text-faint">{w?.blaaizWalletId}</div>
                  </div>
                  <Tag>{CURRENCY_NAME[c]}</Tag>
                </div>
                <div className="mt-5"><Amount minor={fc.balance} currency={c} size="md" /></div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[15px] text-body">Buffer {formatMinor(fc.buffer, { decimals: false })}, {runwayDays(fc, t.today, t.policy.horizonDays)}</span>
                  <Pill tone={h.tone}>{h.label}</Pill>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="space-y-6">
          <div className="card p-6 sm:p-8">
            <div className="flex items-center gap-3"><span className="text-[26px] text-ink">{sel} wallet</span><Tag>Blaaiz</Tag></div>
            <div className="mt-1 font-mono text-[14px] text-faint">{wallet.blaaizWalletId}</div>
            <div className="mt-4"><Amount minor={f.balance} currency={sel} size="xl" animate /></div>

            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-[18px] text-ink">Next {t.policy.horizonDays} days</h2>
              <span className="text-sm text-muted">Balance after</span>
            </div>
            <div className="mt-3 divide-y divide-line border-t border-line text-[15px]">
              <div className="grid grid-cols-[80px_1fr_auto] gap-4 py-4 sm:grid-cols-[90px_1fr_140px_140px]">
                <span className="text-muted">Today</span><span className="text-ink">Current balance</span><span className="hidden sm:block" />
                <span className="num text-right text-ink">{formatMinor(f.balance)}</span>
              </div>
              {f.steps.map((s) => (
                <div key={s.id} className="grid grid-cols-[80px_1fr_auto] gap-4 py-4 sm:grid-cols-[90px_1fr_140px_140px]">
                  <span className="text-muted">{s.date <= t.today ? "Due" : shortDate(s.date)}</span>
                  <span className="text-ink">{s.label}</span>
                  <span className="num hidden text-right text-body sm:block">-{formatMinor(s.amount)}</span>
                  <span className={`num text-right ${s.balanceAfter < f.buffer ? "text-amber" : "text-ink"}`}>{formatMinor(s.balanceAfter)}</span>
                </div>
              ))}
              {f.steps.length === 0 && <div className="py-4 text-muted">No {sel} payments in the horizon.</div>}
            </div>

            {f.belowBufferOn && (
              <div className="mt-6 flex flex-col gap-4 rounded-xl bg-amber-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[16px] text-ink">{sel} drops below its buffer on {shortDate(f.belowBufferOn)}</div>
                  <div className="mt-1 text-[15px] text-body">
                    {waiting ? `Swap #${waiting.number} is waiting for you and would keep it above ${formatMoney(f.buffer, sel, { decimals: false })}.` : sources.length ? `Next cycle rebalances from ${sources.join(" or ")} if one has surplus above its buffer.` : "No allowed pair can top it up. Allow one in Rules."}
                  </div>
                </div>
                {waiting ? (
                  <Link href={`/app/approvals?id=${waiting.id}`} className="btn-primary shrink-0">Review #{waiting.number}</Link>
                ) : (
                  <form action={runCycleAction}><SubmitButton className="btn-primary shrink-0" pendingText="Running cycle">Run cycle</SubmitButton></form>
                )}
              </div>
            )}

            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-[18px] text-ink">Rules for this wallet</h2>
              <TextLink href="/app/rules">Edit in Rules</TextLink>
            </div>
            <div className="mt-3 border-t border-line">
              <Row label="Buffer" value={formatMoney(t.policy.buffer[sel] ?? 0, sel, { decimals: false })} />
              <Row label="Per payment" value={formatMoney(t.policy.perPaymentCap[sel] ?? 0, sel, { decimals: false })} />
              <Row label="Tops up from" value={sources.length ? sources.map((c) => `${c} wallet`).join(", ") : "Not allowed"} />
              <Row label="Pays out to" value={[...new Set(t.payments.filter((p) => p.currency === sel).map((p) => p.payee.name))].slice(0, 3).join(", ") || "Nobody scheduled"} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h2 className="text-[18px] text-ink">Fund by bank transfer</h2>
              {wallet.vaAccountNumber ? (
                <>
                  <p className="mt-1 text-sm text-muted">Transfers to this account land in the {sel} wallet. Bursar runs a cycle as soon as Blaaiz confirms the deposit.</p>
                  <dl className="mt-4 space-y-2 rounded-xl bg-canvas p-4 text-[15px]">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Bank</dt><dd className="text-ink">{wallet.vaBankName}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Account number</dt><dd className="num font-mono text-ink">{wallet.vaAccountNumber}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd className="text-ink">{wallet.vaAccountName}</dd></div>
                  </dl>
                </>
              ) : sel === "NGN" ? (
                <form action={createVirtualAccountAction} className="mt-3">
                  <p className="text-sm text-muted">Blaaiz gives this wallet its own Nigerian bank account. Anyone can fund it by transfer.</p>
                  <input type="hidden" name="currency" value={sel} />
                  <SubmitButton className="btn-primary mt-4" pendingText="Creating account">Create funding account</SubmitButton>
                </form>
              ) : (
                <p className="mt-2 text-sm text-muted">Fund {sel} by converting from NGN. Only NGN deposits settle in the Blaaiz development sandbox.</p>
              )}
              {mock && (
                <form action={simulateDeposit} className="mt-4 border-t border-line pt-4">
                  <div className="text-sm text-muted">Mock only: simulate a transfer arriving.</div>
                  <div className="mt-2 flex gap-2">
                    <input type="hidden" name="currency" value={sel} />
                    <label htmlFor="dep-amt" className="sr-only">Amount in {sel}</label>
                    <input id="dep-amt" name="amount" className="input" inputMode="decimal" defaultValue={sel === "NGN" ? "1000000" : "500"} />
                    <SubmitButton className="btn-outline shrink-0" pendingText="Depositing">Deposit</SubmitButton>
                  </div>
                </form>
              )}
            </div>

            <form action={convertCurrency} className="card p-6">
              <h2 className="text-[18px] text-ink">Convert into {sel}</h2>
              <p className="mt-1 text-sm text-muted">A swap between your own wallets. Blaaiz previews the rate and fee first, and every rule is still checked.</p>
              {held.length > 1 ? (
                <div className="mt-4 space-y-3">
                  <input type="hidden" name="to" value={sel} />
                  <div>
                    <label htmlFor="conv-from" className="label">From</label>
                    <select id="conv-from" name="from" className="input">
                      {held.filter((c) => c !== sel).map((c) => <option key={c} value={c}>{c} wallet, {formatMoney(t.fc[c].balance, c, { decimals: false })}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conv-amt" className="label">{sel} to receive</label>
                    <input id="conv-amt" name="amount" className="input num" inputMode="decimal" required placeholder="1000" />
                  </div>
                  <p className="text-sm text-muted">Today: {formatRate(held.find((c) => c !== sel)!, sel, t.rates)}</p>
                  <SubmitButton className="btn-primary w-full" pendingText="Converting">Preview and convert</SubmitButton>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Add another wallet to convert between currencies.</p>
              )}
            </form>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-3">
              <h2 className="text-[18px] text-ink">Ledger</h2>
              <span className="text-sm text-muted">Every movement Bursar recorded in {sel}</span>
            </div>
            {ledger.length ? (
              <table className="w-full text-left text-[15px]">
                <caption className="sr-only">{sel} ledger</caption>
                <thead className="bg-canvas/60 text-muted">
                  <tr>{["When", "Movement", "Amount"].map((h) => <th key={h} scope="col" className={`px-6 py-2.5 font-normal ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-6 py-3 text-muted">{dateTime(l.at)}</td>
                      <td className="px-6 py-3"><span className="text-ink">{LEDGER_LABEL[l.kind] ?? l.kind}</span><span className="block text-sm text-muted">{l.memo}</span></td>
                      <td className={`num whitespace-nowrap px-6 py-3 text-right ${bn(l.amount) < 0 ? "text-ink" : "text-good"}`}>{bn(l.amount) > 0 ? "+" : ""}{formatMinor(bn(l.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-6 pb-6 text-[15px] text-muted">Nothing recorded in {sel} yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
