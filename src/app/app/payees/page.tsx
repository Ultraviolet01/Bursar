import { PageHeader, Pill } from "@/components/ui";
import { requireCompany } from "@/lib/auth";
import { SubmitButton } from "@/components/interactive";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, type Category } from "@/engine/types";
import { createPayee, registerPayeeAction, savePayeeKyc, toggleAllowlist, toggleCritical } from "../actions";
import { parseCurrencies } from "@/lib/money";

const ID_TYPES = [["id_card", "National ID card"], ["passport", "Passport"], ["drivers_license", "Driver's licence"], ["resident_permit", "Residence permit"], ["certificate_of_incorporation", "Certificate of incorporation"]];

export default async function Payees() {
  const { company } = await requireCompany();
  const payees = await db.payee.findMany({ where: { companyId: company.id }, orderBy: [{ allowlisted: "asc" }, { name: "asc" }], include: { _count: { select: { payments: true } } } });
  const waiting = payees.filter((p) => !p.allowlisted).length;
  const unregistered = payees.filter((p) => !p.blaaizCustomerId).length;
  const held = parseCurrencies(company.currencies);
  return (
    <>
      <PageHeader title="Payees" subtitle={`${payees.length} payees, ${waiting} not allowlisted, ${unregistered} not yet Blaaiz customers`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[15px]">
              <caption className="sr-only">Payees</caption>
              <thead className="bg-canvas/60 text-muted">
                <tr>{["Payee", "Category", "Pays to", "Blaaiz customer", "Critical", "Allowlist"].map((h) => <th key={h} scope="col" className="px-5 py-3 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payees.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-canvas/60">
                    <td className="px-5 py-4">
                      <div className="text-ink">{p.name}</div>
                      <div className="text-sm text-muted">{p.currency}, {p._count.payments} payment{p._count.payments === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-5 py-4 text-body">{CATEGORY_LABEL[p.category as Category]}</td>
                    <td className="px-5 py-4 text-body">
                      {p.method === "mobile_money" ? `Mobile money ${p.phone ?? ""}` : `${p.bankName ?? "Bank"} ...${p.accountNumber?.slice(-4) ?? "----"}`}
                      <div className="text-sm text-muted">{p.verifiedAt ? "Account checked" : "Not verified"}</div>
                    </td>
                    <td className="px-5 py-4">
                      {p.blaaizCustomerId ? (
                        <span className="font-mono text-sm text-ink" title={p.blaaizCustomerId}>{p.blaaizCustomerId.length > 16 ? `${p.blaaizCustomerId.slice(0, 14)}...` : p.blaaizCustomerId}</span>
                      ) : p.email && p.country && p.idType && p.idNumber ? (
                        <form action={registerPayeeAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <SubmitButton className="rounded-md px-2 py-1 text-sm text-teal transition hover:bg-teal-tint" pendingText="Registering">Register<span className="sr-only"> {p.name} with Blaaiz</span></SubmitButton>
                        </form>
                      ) : (
                        <details className="group">
                          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-teal hover:bg-teal-tint">Add details<span className="sr-only"> for {p.name}</span></summary>
                          <form action={savePayeeKyc} className="animate-pop mt-2 w-64 space-y-2 rounded-xl border border-line bg-surface p-3 shadow-md">
                            <input type="hidden" name="id" value={p.id} />
                            <label className="label" htmlFor={`em-${p.id}`}>Email</label>
                            <input id={`em-${p.id}`} name="email" type="email" required className="input" />
                            <div className="grid grid-cols-[70px_1fr] gap-2">
                              <div><label className="label" htmlFor={`co-${p.id}`}>Country</label><input id={`co-${p.id}`} name="country" required maxLength={2} placeholder="NG" className="input uppercase" /></div>
                              <div><label className="label" htmlFor={`it-${p.id}`}>ID type</label><select id={`it-${p.id}`} name="idType" className="input">{ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                            </div>
                            <label className="label" htmlFor={`in-${p.id}`}>ID number</label>
                            <input id={`in-${p.id}`} name="idNumber" required minLength={3} className="input" />
                            <SubmitButton className="btn-primary btn-sm w-full" pendingText="Registering">Save and register</SubmitButton>
                          </form>
                        </details>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <form action={toggleCritical}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="rounded-full text-sm transition hover:opacity-80" aria-label={`${p.critical ? "Critical" : "Can wait"}: ${p.name}. Toggle`}>{p.critical ? <Pill tone="teal">Critical</Pill> : <span className="text-muted hover:text-ink">Can wait</span>}</button>
                      </form>
                    </td>
                    <td className="px-5 py-4">
                      <form action={toggleAllowlist} className="flex items-center gap-3">
                        <input type="hidden" name="id" value={p.id} />
                        {p.allowlisted ? <Pill tone="good">Allowlisted</Pill> : <Pill tone="amber">Needs approval</Pill>}
                        <SubmitButton className="rounded-md px-2 py-1 text-sm text-teal transition hover:bg-teal-tint" pendingText="Saving">{p.allowlisted ? "Remove" : "Allow"}<span className="sr-only"> {p.name}</span></SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form action={createPayee} className="card self-start p-6">
          <h2 className="text-[18px] font-medium text-ink">Add a payee</h2>
          <p className="mt-1 text-sm text-muted">New payees start off the allowlist. Bursar asks before paying them the first time.</p>
          <div className="mt-5 space-y-4">
            <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="category">Category</label>
                <select id="category" name="category" className="input">{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="currency">Currency</label>
                <select id="currency" name="currency" className="input">{held.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="method">Method</label>
              <select id="method" name="method" className="input"><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option></select>
            </div>
            <div><label className="label" htmlFor="bankName">Bank</label><input id="bankName" name="bankName" className="input" placeholder="Access Bank" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="accountNumber">Account number</label><input id="accountNumber" name="accountNumber" className="input num" inputMode="numeric" /></div>
              <div><label className="label" htmlFor="phone">Phone (momo)</label><input id="phone" name="phone" className="input" placeholder="+234..." /></div>
            </div>
            <div><label className="label" htmlFor="accountName">Account name</label><input id="accountName" name="accountName" className="input" /></div>
            <fieldset className="space-y-3 rounded-xl bg-canvas p-4">
              <legend className="px-1 text-sm text-ink">Blaaiz customer details</legend>
              <p className="text-sm text-muted">Blaaiz needs these to register the payee as a customer. Allowlisting registers them automatically.</p>
              <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" maxLength={2} placeholder="NG" className="input uppercase" /></div>
                <div><label className="label" htmlFor="idType">ID type</label><select id="idType" name="idType" className="input"><option value="">Choose</option>{ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              </div>
              <div><label className="label" htmlFor="idNumber">ID number</label><input id="idNumber" name="idNumber" className="input" /></div>
            </fieldset>
            <SubmitButton className="btn-primary w-full" pendingText="Adding">Add payee</SubmitButton>
          </div>
        </form>
      </div>
    </>
  );
}
