import Link from "next/link";
import type { Payee, ScheduledPayment } from "@prisma/client";
import { IconArrowRight, IconCheck, IconShield, IconX } from "@/components/icons";
import { Amount, Empty, PageHeader, Pill } from "@/components/ui";
import { db } from "@/lib/db";
import { loadPolicy } from "@/lib/repo";
import { dateTime, shortDate, timeAgo } from "@/lib/dates";
import { bn, type Currency, formatMinor, formatMoney } from "@/lib/money";
import { kindLabel, outcome, parsed, reasonLabel, title } from "@/lib/view";
import type { PolicyConfig, ProposedAction } from "@/engine/types";
import type { CheckStatus } from "@/engine/policy";
import { approveProposal, rejectProposal } from "../actions";

type Search = Promise<{ id?: string; tab?: string; blocked?: string }>;

export default async function Approvals({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tab = sp.tab === "decided" ? "decided" : "waiting";
  const [waiting, decided, wallets, policy, rate] = await Promise.all([
    db.action.findMany({ where: { status: "PENDING" }, orderBy: { number: "desc" } }),
    db.action.findMany({ where: { decidedBy: "OWNER" }, orderBy: { decidedAt: "desc" }, take: 20 }),
    db.wallet.findMany(),
    loadPolicy(db),
    db.rateSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } }),
  ]);
  const list = tab === "waiting" ? waiting : decided;
  const selectedId = sp.id ?? list[0]?.id ?? waiting[0]?.id;
  const selected = selectedId ? await db.action.findUnique({ where: { id: selectedId } }) : null;
  const paymentIds = [...waiting, ...decided, ...(selected ? [selected] : [])].map((a) => a.paymentId).filter((x): x is string => !!x);
  const payments = await db.scheduledPayment.findMany({ where: { id: { in: paymentIds } }, include: { payee: true } });
  const pay = new Map(payments.map((p) => [p.id, p]));
  const bal = (c: string) => bn(wallets.find((w) => w.currency === c)?.balance);

  return (
    <>
      <PageHeader title="Approvals" subtitle={`${waiting.length} waiting for you`} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,440px)_1fr]">
        <div className="card self-start p-5">
          <div className="mb-4 inline-flex rounded-lg bg-canvas p-1">
            <Link href="/app/approvals" className={`tab ${tab === "waiting" ? "tab-active" : ""}`}>Waiting ({waiting.length})</Link>
            <Link href="/app/approvals?tab=decided" className={`tab ${tab === "decided" ? "tab-active" : ""}`}>Decided</Link>
          </div>
          {list.length === 0 && <Empty>{tab === "waiting" ? "Nothing is waiting for you." : "You have not decided anything yet."}</Empty>}
          <div className="space-y-2">
            {list.map((a) => {
              const k = tab === "waiting" ? kindLabel(a) : outcome(a);
              const p = JSON.parse(a.payload) as ProposedAction;
              const active = a.id === selected?.id;
              const payee = pay.get(a.paymentId ?? "")?.payee.name;
              return (
                <Link
                  key={a.id}
                  href={`/app/approvals?id=${a.id}${tab === "decided" ? "&tab=decided" : ""}`}
                  className={`block rounded-xl border px-4 py-3.5 ${active ? "border-teal bg-teal-soft" : "border-transparent hover:bg-canvas"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Pill tone={k.tone}>{k.label}</Pill>
                    <span className="text-sm text-faint">{timeAgo(a.decidedAt ?? a.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <span className="text-[16px] text-ink">{title(a, payee)}</span>
                    <span className="num whitespace-nowrap text-[15px] text-ink">{formatMoney(p.amount, p.currency)}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted">{a.explanation.split(":").slice(-1)[0].trim().replace(/\.$/, "")}</div>
                </Link>
              );
            })}
          </div>
        </div>

        {selected ? (
          <Detail
            action={selected}
            payment={pay.get(selected.paymentId ?? "")}
            policy={policy}
            bal={bal}
            walletIds={Object.fromEntries(wallets.map((w) => [w.currency, w.blaaizWalletId]))}
            rate={rate ? { value: rate.rate, at: rate.fetchedAt } : null}
            blocked={selected.id === sp.id ? sp.blocked : undefined}
          />
        ) : (
          <div className="card p-8"><Empty>Select a proposal to see why Bursar raised it.</Empty></div>
        )}
      </div>
    </>
  );
}

function why(a: ProposedAction, payment: (ScheduledPayment & { payee: Payee }) | undefined, policy: PolicyConfig, bal: (c: string) => number): string[] {
  const out: string[] = [];
  const cur = a.currency;
  for (const r of a.reasons) {
    if (r === "NEW_PAYEE") out.push(`${payment?.payee.name} is not on your allowlist. Bursar never pays a new payee alone.`);
    if (r === "OVER_PAYMENT_CAP") out.push(`${formatMoney(a.amount, cur)} is over your ${formatMoney(policy.perPaymentCap[cur], cur)} per-payment line.`);
    if (r === "OVER_DAILY_CAP") out.push(`Paying it would take today's total over ${formatMoney(policy.dailyCapNgn, "NGN")}.`);
    if (r === "SHORTFALL_CRITICAL") out.push(`${cur} has ${formatMoney(Math.max(0, bal(cur) - policy.buffer[cur]), cur)} above its buffer and no wallet could cover the gap within your rules.`);
    if (r === "RATE_TOO_WIDE") out.push(`Today's rate is more than ${policy.maxRateDeviationPct}% worse than the 7-day average.`);
    if (r === "OVER_SWAP_CAP") out.push(`The swap needed is over your ${formatMoney(policy.perSwapCapNgn, "NGN")} swap cap.`);
    if (r === "PAIR_NOT_ALLOWED") out.push(`The swap needed uses a currency pair you have not allowed.`);
    if (r === "MAX_DEFER_REACHED") out.push(`It has been deferred for ${policy.maxDeferDays} days, the most your rules allow.`);
    if (r === "BELOW_BUFFER_FORECAST") out.push(`${a.notes[0]?.replace(/(\d{4}-\d{2}-\d{2})/, (d) => shortDate(d)) ?? `${cur} is forecast to dip below its buffer`}.`);
    if (r === "PAYOUT_FAILED") out.push(`Blaaiz reported the last attempt failed: ${a.notes[0] ?? "no reason given"}.`);
    if (r === "ROUTINE_OK") out.push("Within your rules, but auto-execute is off or a live check needs you.");
  }
  const swap = a.type === "ESCALATE" ? a.plan?.swap : a.swap;
  if (swap) out.push(`Approving swaps ${formatMoney(swap.fromAmount, swap.from)} into ${formatMoney(swap.toAmount, swap.to)} first, at about ${swap.rate.toLocaleString("en-US")} NGN per USD including the swap fee.`);
  if (a.type !== "SWAP") out.push(`Blaaiz charges about ${formatMoney(a.fee, cur)}, so ${formatMoney(a.amount + a.fee, cur)} leaves the ${cur} wallet.`);
  return out;
}

const CHECK: Record<CheckStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pass: { label: "Pass", cls: "text-good", icon: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-good-soft text-good"><IconCheck className="h-4 w-4" /></span> },
  approved: { label: "Approved", cls: "text-good", icon: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-good-soft text-good"><IconCheck className="h-4 w-4" /></span> },
  needs_owner: { label: "Needs you", cls: "text-amber", icon: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-soft text-amber"><IconShield className="h-4 w-4" /></span> },
  fail: { label: "Blocked", cls: "text-bad", icon: <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bad-soft text-bad"><IconX className="h-4 w-4" /></span> },
};

function Box({ top, title, sub }: { top: string; title: string; sub: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-5 py-4">
      <div className="text-sm text-muted">{top}</div>
      <div className="mt-1 text-[17px] text-ink">{title}</div>
      <div className="num mt-1 text-sm text-body">{sub}</div>
    </div>
  );
}

function Flow({ left, mid, midSub, right }: { left: React.ReactNode; mid: string; midSub: string; right: React.ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
      {left}
      <div className="flex w-[150px] shrink-0 flex-col items-center self-center text-center">
        <IconArrowRight className="h-6 w-16 text-teal" />
        <div className="mt-1 text-[15px] text-teal">{mid}</div>
        <div className="text-sm text-muted">{midSub}</div>
      </div>
      {right}
    </div>
  );
}

function Detail({ action, payment, policy, bal, walletIds, rate, blocked }: {
  action: Awaited<ReturnType<typeof db.action.findUniqueOrThrow>>;
  payment?: ScheduledPayment & { payee: Payee };
  policy: PolicyConfig;
  bal: (c: string) => number;
  walletIds: Record<string, string>;
  rate: { value: number; at: Date } | null;
  blocked?: string;
}) {
  const { proposal: a, policy: result } = parsed(action);
  const swap = a.type === "ESCALATE" ? a.plan?.swap : a.swap;
  const payout = a.type !== "SWAP";
  const cur = a.currency as Currency;
  const o = outcome(action);
  const pending = action.status === "PENDING";
  const fmt = (m: number, c: string) => formatMoney(m, c);

  return (
    <div className="card p-6 sm:p-8">
      {blocked && (
        <div className="mb-6 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-[15px] text-bad">Not executed. The live policy check blocked it: {blocked}</div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {pending ? <Pill tone="amber">Needs your approval</Pill> : <Pill tone={o.tone}>{o.label}</Pill>}
            <span className="text-[15px] text-muted">
              Proposal #{action.number}, created by Bursar {timeAgo(action.createdAt)}
              {action.decidedAt && `, decided ${dateTime(action.decidedAt)}`}
            </span>
          </div>
          <h2 className="mt-4 text-[28px] text-ink">{title(action, payment?.payee.name)}</h2>
          <div className="mt-3"><Amount minor={a.amount} currency={cur} size="xl" /></div>
        </div>
        {rate && (
          <div className="shrink-0 rounded-xl bg-amber-card px-5 py-3 sm:text-right">
            <div className="whitespace-nowrap text-sm text-amber">USD/NGN, {timeAgo(rate.at)}</div>
            <div className="display num mt-1 text-[30px] text-amber">{rate.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
          </div>
        )}
      </div>

      <div className="mt-8 space-y-3 rounded-2xl bg-canvas p-4 sm:p-5">
        {swap && (
          <Flow
            left={<Box top={`${swap.from} wallet`} title={`Treasury ${swap.from}`} sub={`${formatMinor(bal(swap.from))} → ${formatMinor(bal(swap.from) - swap.fromAmount)}`} />}
            mid="Blaaiz swap"
            midSub={`Lands exactly ${fmt(swap.toAmount, swap.to)}`}
            right={<Box top={`${swap.to} wallet`} title={`Treasury ${swap.to}`} sub={`${formatMinor(bal(swap.to))} → ${formatMinor(bal(swap.to) + swap.toAmount)}`} />}
          />
        )}
        {payout && payment && (
          <Flow
            left={<Box top={`${cur} wallet`} title={`Treasury ${cur}`} sub={`${formatMinor(bal(cur) + (swap?.toAmount ?? 0))} → ${formatMinor(bal(cur) + (swap?.toAmount ?? 0) - a.amount - a.fee)}`} />}
            mid="Blaaiz payout"
            midSub={`Bank transfer, fee ${fmt(a.fee, cur)}`}
            right={<Box top={payment.payee.bankName ?? "Bank"} title={payment.payee.name} sub={`Account ${payment.payee.accountNumber ? `...${payment.payee.accountNumber.slice(-4)}` : "not set"}`} />}
          />
        )}
      </div>

      <h3 className="mt-8 flex items-center gap-2 text-[18px] text-ink"><IconShield className="h-5 w-5 text-teal" />Why Bursar proposed this</h3>
      <ol className="mt-3 space-y-2.5">
        {why(a, payment, policy, bal).map((line, i) => (
          <li key={i} className="flex gap-3 text-[15px] text-body">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-canvas text-sm text-muted">{i + 1}</span>
            <span className="pt-0.5">{line}</span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[18px] text-ink"><IconShield className="h-5 w-5 text-teal" />Policy checks</h3>
        <span className="text-sm text-muted">rechecked live on approval</span>
      </div>
      <div className="mt-3 divide-y divide-line border-y border-line">
        {result.checks.map((c) => (
          <div key={c.id} className="flex items-center gap-4 py-3.5">
            {CHECK[c.status].icon}
            <div className="min-w-0 flex-1">
              <div className="text-[15px] text-ink">{c.label}</div>
              <div className="text-sm text-muted">{c.detail}</div>
            </div>
            <span className={`text-[15px] ${CHECK[c.status].cls}`}>{CHECK[c.status].label}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          <div>Primary reason: {reasonLabel(action.reasonCode)}</div>
          {payment && <div className="mt-0.5 break-all font-mono text-[13px] text-faint">{payment.merchantReference}</div>}
          {walletIds[cur] && !payment && <div className="mt-0.5 font-mono text-[13px] text-faint">{walletIds[cur]}</div>}
        </div>
        {pending && (
          <div className="flex gap-2">
            <form action={rejectProposal}>
              <input type="hidden" name="id" value={action.id} />
              <button className="btn-danger">Reject</button>
            </form>
            <form action={approveProposal}>
              <input type="hidden" name="id" value={action.id} />
              <button className="btn-primary">Approve and run</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
