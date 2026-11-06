import { IconLine } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { requireCompany } from "@/lib/auth";
import { SubmitButton } from "@/components/interactive";
import { db } from "@/lib/db";
import { formatMinor } from "@/lib/money";
import { loadPolicy } from "@/lib/repo";
import { savePolicy } from "../actions";
import { parseCurrencies } from "@/lib/money";

function Field({ name, label, hint, value, suffix }: { name: string; label: string; hint: string; value: string | number; suffix?: string }) {
  return (
    <div className="grid gap-2 border-t border-line py-5 first:border-t-0 sm:grid-cols-[1fr_260px] sm:items-center">
      <div>
        <label htmlFor={name} className="text-[15px] text-ink">{label}</label>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <input id={name} name={name} defaultValue={value} className="input num text-right" required />
        {suffix && <span className="w-12 text-sm text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

export default async function Rules() {
  const { company } = await requireCompany();
  const p = await loadPolicy(db, company.id);
  const held = parseCurrencies(company.currencies);
  const pairs = held.flatMap((a) => held.filter((b) => b !== a).map((b) => `${a}>${b}`));
  const m = (v: number) => formatMinor(v).replace(/,/g, "").replace(/\.00$/, "");
  return (
    <>
      <PageHeader title="Rules" subtitle="Your line. Bursar checks every move against these before money leaves a wallet." />
      <form action={savePolicy} className="grid gap-6 xl:grid-cols-2">
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-[18px] text-ink"><IconLine className="h-5 w-7 text-amber" />Limits</h2>
          <div className="mt-2">
            {held.map((c) => (
              <Field key={c} name={`cap${c}`} label={`Per payment, ${c}`} hint="Larger payments wait for you" value={m(p.perPaymentCap[c] ?? 0)} suffix={c} />
            ))}
            <Field name="dailyCapNgn" label="Per day, all currencies" hint="Total paid out today, in NGN equivalent" value={m(p.dailyCapNgn)} suffix="NGN" />
            <Field name="perSwapCapNgn" label="Per swap" hint="Largest single currency swap, NGN equivalent" value={m(p.perSwapCapNgn)} suffix="NGN" />
          </div>
        </div>
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Buffers and timing</h2>
          <div className="mt-2">
            {held.map((c) => (
              <Field key={c} name={`buffer${c}`} label={`${c} buffer`} hint="Never spent by an automated action" value={m(p.buffer[c] ?? 0)} suffix={c} />
            ))}
            <Field name="horizonDays" label="Planning horizon" hint="How far ahead Bursar forecasts" value={p.horizonDays} suffix="days" />
            <Field name="maxDeferDays" label="Max defer window" hint="After this, a held bill is escalated to you" value={p.maxDeferDays} suffix="days" />
          </div>
        </div>
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Rebalancing</h2>
          <p className="mt-1 text-sm text-muted">Which of your own wallets Bursar may swap between when one runs short. It never takes a wallet below its buffer.</p>
          <fieldset className="mt-4 grid grid-cols-1 gap-3 text-[15px] sm:grid-cols-2">
            <legend className="sr-only">Allowed currency pairs</legend>
            {pairs.map((pair) => (
              <label key={pair} className="flex items-center gap-3">
                <input type="checkbox" name={`pair_${pair}`} defaultChecked={p.allowedPairs.includes(pair)} className="h-4 w-4 accent-teal" />
                <span className="text-ink">Allow {pair.replace(">", " to ")}</span>
              </label>
            ))}
            {pairs.length === 0 && <p className="text-sm text-muted">Add a second wallet to allow swaps.</p>}
          </fieldset>
          <Field name="maxRateDeviationPct" label="Max rate deviation" hint="Skip a swap if the rate is this much worse than the 7-day average" value={p.maxRateDeviationPct} suffix="%" />
        </div>
        <div className="card p-6">
          <h2 className="text-[18px] text-ink">Execution</h2>
          <label className="mt-4 flex items-start gap-3 text-[15px]">
            <input type="checkbox" name="autoExecute" defaultChecked={p.autoExecute} className="mt-1 h-4 w-4 accent-teal" />
            <span>
              <span className="text-ink">Auto-execute routine actions</span>
              <span className="block text-sm text-muted">When off, every payment and swap becomes a proposal. New payees always need you either way.</span>
            </span>
          </label>
          <div className="mt-6 rounded-xl bg-canvas p-4 text-sm text-muted">
            Always on: one payout per payment occurrence (merchant reference), allowlist for new payees, the pause switch, and a live re-check of every rule right before Blaaiz is called.
          </div>
          <div className="mt-6"><SubmitButton className="btn-primary w-full sm:w-auto" pendingText="Saving">Save rules</SubmitButton></div>
        </div>
      </form>
    </>
  );
}
