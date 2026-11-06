import { SubmitButton, WelcomeOnSubmit } from "./interactive";

/** Shared by onboarding (first company) and "Add a company". */
export function CompanyForm({ action, mock, first, onboarding = false }: { action: (f: FormData) => void | Promise<void>; mock: boolean; first: boolean; onboarding?: boolean }) {
  return (
    <form action={action} className={onboarding ? "space-y-5 px-6 pb-6 pt-4 sm:px-8 sm:pb-8" : "card space-y-5 p-6 sm:p-8"}>
      {onboarding && <WelcomeOnSubmit />}
      <div>
        <label htmlFor="name" className="label">Company name</label>
        <input id="name" name="name" required minLength={2} className="input" placeholder="Kaduna Freight Ltd" autoFocus={onboarding} />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-[15px] text-ink">Currency wallets</legend>
        <p className="text-sm text-muted">NGN is your base wallet. Add the currencies you pay in; Bursar rebalances between them.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["NGN", "USD", "EUR", "GBP"] as const).map((c) => (
            <div key={c} className="rounded-xl border border-line p-3">
              <label className="flex items-center gap-2 text-[15px] text-ink">
                <input type="checkbox" name={`cur_${c}`} defaultChecked={c === "NGN" || c === "USD"} disabled={c === "NGN"} className="h-4 w-4 accent-teal" />
                {c}
              </label>
              {mock && (
                <>
                  <label htmlFor={`opening_${c}`} className="sr-only">Opening {c} balance</label>
                  <input id={`opening_${c}`} name={`opening_${c}`} type="number" min={0} step="0.01" placeholder="0" defaultValue={first ? ({ NGN: 5000000, USD: 1000, EUR: 0, GBP: 0 } as const)[c] : 0} className="input num mt-2 px-2 py-1.5 text-sm" />
                </>
              )}
            </div>
          ))}
        </div>
        {mock ? <p className="text-sm text-muted">Mock mode: the numbers are opening balances. In live mode Bursar reads real balances from Blaaiz.</p> : <p className="text-sm text-muted">In live mode, create these wallets in Blaaiz; Bursar uses the ones Blaaiz returns.</p>}
      </fieldset>
      {mock && (
        <label className="flex items-start gap-3 rounded-xl bg-canvas p-4 text-[15px]">
          <input type="checkbox" name="demo" className="mt-1 h-4 w-4 accent-teal" />
          <span>
            <span className="text-ink">Fill it with demo data instead</span>
            <span className="block text-sm text-muted">NGN 8,000,000 and USD 1,200, three salaries, vendors and bills due today, like the spec&apos;s demo company.</span>
          </span>
        </label>
      )}
      <SubmitButton className="btn-primary w-full py-2.5" pendingText={onboarding ? "Setting up your dashboard" : "Creating company"}>Create company</SubmitButton>
      <p className="text-sm text-muted">Rules start at the spec defaults (NGN 2,000,000 per payment, NGN 5,000,000 per day, buffers per wallet). You review them as the last setup step.</p>
    </form>
  );
}
