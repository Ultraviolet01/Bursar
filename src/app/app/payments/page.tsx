import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { SubmitButton } from "@/components/interactive";
import { PageHeader, Pill, type Tone } from "@/components/ui";
import { db } from "@/lib/db";
import { addDays, isoDate, shortDate } from "@/lib/dates";
import { bn, formatMinor } from "@/lib/money";
import { CATEGORY_LABEL, type Category } from "@/engine/types";
import { cancelPayment, createPayment } from "../actions";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "Scheduled", tone: "grey" },
  DEFERRED: { label: "Deferred", tone: "amber" },
  PROPOSED: { label: "Waiting for you", tone: "amber" },
  EXECUTING: { label: "Sending", tone: "teal" },
  PAID: { label: "Paid", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
};
const FILTERS = ["ALL", "SCHEDULED", "DEFERRED", "PROPOSED", "EXECUTING", "PAID", "CANCELLED"];

export default async function Payments({ searchParams }: { searchParams: Promise<{ status?: string; category?: string }> }) {
  const sp = await searchParams;
  const status = FILTERS.includes(sp.status ?? "") ? sp.status! : "ALL";
  const category = sp.category && sp.category in CATEGORY_LABEL ? sp.category : "ALL";
  const today = isoDate();
  const { company } = await requireCompany();
  const [payments, payees] = await Promise.all([
    db.scheduledPayment.findMany({
      where: { companyId: company.id, ...(status !== "ALL" ? { status } : {}), ...(category !== "ALL" ? { payee: { category } } : {}) },
      include: { payee: true },
      orderBy: [{ dueDate: "asc" }, { priority: "asc" }],
    }),
    db.payee.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" } }),
  ]);
  const q = (s: string, c: string) => `/app/payments?status=${s}&category=${c}`;

  return (
    <>
      <PageHeader title="Payments" subtitle="Everything Bursar knows is coming up" />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-canvas p-1">
              {FILTERS.map((s) => (
                <Link key={s} href={q(s, category)} aria-current={status === s ? "page" : undefined} className={`tab shrink-0 ${status === s ? "tab-active" : ""}`}>{s === "ALL" ? "All" : STATUS[s].label}</Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {["ALL", ...Object.keys(CATEGORY_LABEL)].map((c) => (
                <Link key={c} href={q(status, c)} className={`rounded-full border px-3 py-1 ${category === c ? "border-teal bg-teal-soft text-teal" : "border-line text-muted hover:text-ink"}`}>
                  {c === "ALL" ? "All categories" : CATEGORY_LABEL[c as Category]}
                </Link>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <caption className="sr-only">Scheduled payments</caption>
              <thead className="bg-canvas/60 text-muted">
                <tr>{["Due", "Payee", "Category", "Amount", "Repeats", "Status", ""].map((h) => <th key={h} scope="col" className={`px-5 py-3 font-normal ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payments.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-canvas/60">
                    <td className="whitespace-nowrap px-5 py-4 text-muted">{p.dueDate < today && !["PAID", "CANCELLED"].includes(p.status) ? <span className="text-amber">Overdue {shortDate(p.dueDate)}</span> : p.dueDate === today ? "Today" : shortDate(p.dueDate)}</td>
                    <td className="px-5 py-4">
                      <div className="text-ink">{p.payee.name}</div>
                      <div className="text-sm text-muted">{p.memo}{p.critical ? " · critical" : ""}</div>
                    </td>
                    <td className="px-5 py-4 text-body">{CATEGORY_LABEL[p.payee.category as Category]}</td>
                    <td className="num whitespace-nowrap px-5 py-4 text-right text-ink">{formatMinor(bn(p.amount))} <span className="text-faint">{p.currency}</span></td>
                    <td className="px-5 py-4 text-body">{p.recurrence === "NONE" ? "Once" : p.recurrence === "WEEKLY" ? "Weekly" : "Monthly"}</td>
                    <td className="px-5 py-4"><Pill tone={STATUS[p.status]?.tone ?? "grey"}>{STATUS[p.status]?.label ?? p.status}</Pill></td>
                    <td className="px-5 py-4 text-right">
                      {["SCHEDULED", "DEFERRED", "PROPOSED"].includes(p.status) && (
                        <form action={cancelPayment}><input type="hidden" name="id" value={p.id} /><SubmitButton className="rounded-md px-2 py-1 text-sm text-muted transition hover:bg-bad-soft hover:text-bad" pendingText="Cancelling">Cancel<span className="sr-only"> payment to {p.payee.name}</span></SubmitButton></form>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-muted">No payments match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <form action={createPayment} className="card self-start p-6">
          <h2 className="text-[18px] font-medium text-ink">Schedule a payment</h2>
          <p className="mt-1 text-sm text-muted">Paid in the payee&apos;s currency. Recipient gets exactly this amount.</p>
          <div className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="payeeId">Payee</label>
              <select id="payeeId" name="payeeId" className="input" required>
                {payees.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency}){p.allowlisted ? "" : ", not allowlisted"}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="amount">Amount</label>
              <input id="amount" name="amount" className="input num" placeholder="450000" required inputMode="decimal" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="dueDate">Due</label>
                <input id="dueDate" type="date" name="dueDate" className="input" defaultValue={addDays(today, 7)} required />
              </div>
              <div>
                <label className="label" htmlFor="recurrence">Repeats</label>
                <select id="recurrence" name="recurrence" className="input" defaultValue="NONE">
                  <option value="NONE">Once</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="memo">Memo</label>
              <input id="memo" name="memo" className="input" placeholder="December salary" />
            </div>
            <SubmitButton className="btn-primary w-full" pendingText="Scheduling">Schedule</SubmitButton>
          </div>
        </form>
      </div>
    </>
  );
}
