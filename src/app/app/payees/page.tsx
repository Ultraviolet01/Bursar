import { PageHeader, Pill } from "@/components/ui";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, type Category } from "@/engine/types";
import { createPayee, toggleAllowlist, toggleCritical } from "../actions";

export default async function Payees() {
  const payees = await db.payee.findMany({ orderBy: [{ allowlisted: "asc" }, { name: "asc" }], include: { _count: { select: { payments: true } } } });
  const waiting = payees.filter((p) => !p.allowlisted).length;
  return (
    <>
      <PageHeader title="Payees" subtitle={`${payees.length} payees, ${waiting} not allowlisted`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="bg-canvas/60 text-muted">
                <tr>{["Payee", "Category", "Pays to", "Critical", "Allowlist"].map((h) => <th key={h} className="px-5 py-3 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payees.map((p) => (
                  <tr key={p.id}>
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
                      <form action={toggleCritical}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-sm">{p.critical ? <Pill tone="teal">Critical</Pill> : <span className="text-muted hover:text-ink">Can wait</span>}</button>
                      </form>
                    </td>
                    <td className="px-5 py-4">
                      <form action={toggleAllowlist} className="flex items-center gap-3">
                        <input type="hidden" name="id" value={p.id} />
                        {p.allowlisted ? <Pill tone="good">Allowlisted</Pill> : <Pill tone="amber">Needs approval</Pill>}
                        <button className="text-sm text-teal hover:underline">{p.allowlisted ? "Remove" : "Allow"}</button>
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
                <select id="currency" name="currency" className="input"><option>NGN</option><option>USD</option></select>
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
            <button className="btn-primary w-full">Add payee</button>
          </div>
        </form>
      </div>
    </>
  );
}
