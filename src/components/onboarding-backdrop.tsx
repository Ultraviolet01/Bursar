// The dashboard as it will look, shown blurred and inert behind the onboarding dialog.
import { IconCalendar, IconCog, IconGrid, IconInbox, IconList, IconSliders, IconUsers, IconWallet } from "./icons";

const NAV = [
  ["Overview", IconGrid],
  ["Approvals", IconInbox],
  ["Payments", IconCalendar],
  ["Payees", IconUsers],
  ["Activity", IconList],
  ["Rules", IconSliders],
  ["Wallets", IconWallet],
  ["Settings", IconCog],
] as const;

function Bar({ w, h = "h-3", className = "" }: { w: string; h?: string; className?: string }) {
  return <div className={`${w} ${h} rounded-full bg-line ${className}`} />;
}

export function OnboardingBackdrop({ name }: { name: string }) {
  return (
    <div className="pointer-events-none select-none" aria-hidden inert>
      <aside className="fixed inset-y-0 left-0 hidden w-[280px] border-r border-line bg-canvas px-4 py-8 lg:block">
        <div className="display px-2 text-[30px] tracking-[0.08em] text-ink">BURSAR</div>
        <div className="mt-7 rounded-xl border border-line bg-surface px-4 py-3.5">
          <div className="text-[15px] font-medium text-ink">Your company</div>
          <Bar w="w-32" className="mt-2" />
        </div>
        <div className="mt-6 flex flex-col gap-1">
          {NAV.map(([label, Icon], i) => (
            <div key={label} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[16px] ${i === 0 ? "border-line bg-surface text-ink" : "border-transparent text-body"}`}>
              <Icon className="h-5 w-5 text-muted" />
              {label}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-4 bottom-8 rounded-2xl bg-navy p-5 text-white">
          <div className="text-[16px] font-medium">Bursar is waiting</div>
          <p className="mt-2 text-sm text-white/75">Add a company to start</p>
        </div>
      </aside>
      <div className="lg:pl-[280px]">
        <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8">
          <div className="display text-[52px] text-ink">Overview</div>
          <p className="mt-2 text-[17px] text-muted">Good to have you, {name}</p>
          <div className="mt-8 grid gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="card p-6">
              <div className="text-[15px] text-body">Total treasury</div>
              <div className="display mt-2 text-[56px] text-ink">0.00</div>
              <svg viewBox="0 0 600 160" className="mt-4 w-full">
                <path d="M0,120 C80,110 120,60 200,70 S320,40 400,60 520,30 600,40" fill="none" className="stroke-teal" strokeWidth={2} />
                <line x1={0} x2={600} y1={135} y2={135} className="stroke-amber-dot" strokeDasharray="4 4" />
              </svg>
            </div>
            <div className="rounded-2xl border border-amber-line bg-amber-card p-5">
              <div className="text-[16px] font-medium text-ink">Needs you</div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl bg-surface p-4"><Bar w="w-40" /><Bar w="w-24" className="mt-2" /></div>
                <div className="rounded-xl bg-surface p-4"><Bar w="w-36" /><Bar w="w-20" className="mt-2" /></div>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {["NGN wallet", "USD wallet"].map((w) => (
              <div key={w} className="card p-6">
                <div className="text-[16px] font-medium text-ink">{w}</div>
                <div className="display mt-4 text-[40px] text-ink">0.00</div>
                <Bar w="w-2/3" className="mt-4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
