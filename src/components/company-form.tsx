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
      {mock ? (
        <fieldset className="space-y-3">
          <legend className="text-[15px] text-ink">Opening balances</legend>
          <p className="text-sm text-muted">Mock mode. In live mode Bursar reads the real balances from Blaaiz.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="openingNgn" className="label">NGN</label>
              <input id="openingNgn" name="openingNgn" type="number" min={0} step="0.01" defaultValue={first ? 5000000 : 0} className="input num" />
            </div>
            <div>
              <label htmlFor="openingUsd" className="label">USD</label>
              <input id="openingUsd" name="openingUsd" type="number" min={0} step="0.01" defaultValue={first ? 1000 : 0} className="input num" />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl bg-canvas p-4 text-[15px]">
            <input type="checkbox" name="demo" className="mt-1 h-4 w-4 accent-teal" />
            <span>
              <span className="text-ink">Fill it with demo data</span>
              <span className="block text-sm text-muted">NGN 8,000,000 and USD 1,200, three salaries, vendors and bills due today, like the spec&apos;s demo company.</span>
            </span>
          </label>
        </fieldset>
      ) : (
        <p className="rounded-xl bg-canvas p-4 text-sm text-muted">After creating it, add this company&apos;s Blaaiz credentials in Settings. Each company is its own Blaaiz business.</p>
      )}
      <SubmitButton className="btn-primary w-full py-2.5" pendingText={onboarding ? "Setting up your dashboard" : "Creating company"}>Create company</SubmitButton>
      <p className="text-sm text-muted">Rules start at the spec defaults: NGN 2,000,000 per payment, NGN 5,000,000 per day, buffers of NGN 300,000 and USD 200. Change them in Rules.</p>
    </form>
  );
}
