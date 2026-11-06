import Link from "next/link";
import { Nav } from "@/components/nav";
import { IconPause, IconPlay } from "@/components/icons";
import { getShell } from "@/lib/dashboard";
import { timeAgo } from "@/lib/dates";
import { togglePause } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { company, pending, lastCycle, mode } = await getShell();
  if (!company) {
    return (
      <main className="mx-auto max-w-lg p-10 text-[15px]">
        <h1 className="display text-4xl text-ink">No company yet</h1>
        <p className="mt-3 text-muted">Seed the demo data first:</p>
        <pre className="mt-3 rounded-lg bg-surface p-4 font-mono text-sm">npm run db:push{"\n"}npm run db:seed</pre>
      </main>
    );
  }
  const paused = company.paused;
  const status = (
    <div className="rounded-2xl bg-navy p-5 text-white">
      <div className="flex items-center gap-2.5 text-[16px] font-medium">
        <span className={`h-2 w-2 rounded-full ${paused ? "bg-amber-dot" : "bg-[#3DB37A]"}`} />
        {paused ? "Bursar is paused" : "Bursar is running"}
      </div>
      <p className="mt-2 text-sm text-white/65">
        {paused ? "Proposals only. Nothing executes until you resume." : lastCycle ? `Checked ${timeAgo(lastCycle.startedAt)}` : "No cycle run yet"}
      </p>
      <form action={togglePause} className="mt-4">
        <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-navy-line bg-navy-2 px-3 py-2.5 text-[15px] hover:bg-navy-line">
          {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
          {paused ? "Resume Bursar" : "Pause all payments"}
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-line px-4 py-8 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <Link href="/" className="display px-2 text-[30px] tracking-[0.08em] text-ink">
          BURSAR
        </Link>
        <div className="mt-7 rounded-xl border border-line bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[15px] font-medium text-ink">{company.name}</span>
            <span className="rounded-md bg-[#ECEFEF] px-2 py-0.5 text-xs text-muted">{mode === "mock" ? "Mock" : "Sandbox"}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[13px] text-faint">{company.blaaizCustomerId}</div>
        </div>
        <div className="mt-6">
          <Nav pending={pending} />
        </div>
        <div className="mt-auto pt-6">{status}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-line bg-canvas lg:hidden">
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/" className="display text-2xl tracking-[0.08em] text-ink">BURSAR</Link>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#ECEFEF] px-2 py-0.5 text-xs text-muted">{mode === "mock" ? "Mock" : "Sandbox"}</span>
              <form action={togglePause}>
                <button className={`btn btn-sm ${paused ? "btn-primary" : "btn-outline"}`}>{paused ? "Resume" : "Pause"}</button>
              </form>
            </div>
          </div>
          <Nav pending={pending} compact />
        </header>
        {mode === "mock" && (
          <div className="border-b border-amber-line/60 bg-amber-card px-4 py-2.5 text-sm text-[#6B5320] sm:px-8">
            Mock mode. Balances, rates, payouts and webhooks are simulated. Set <code className="font-mono">BLAAIZ_MODE=live</code> to use the Blaaiz sandbox.
          </div>
        )}
        {paused && (
          <div className="border-b border-bad-line bg-bad-soft px-4 py-2.5 text-sm text-bad sm:px-8">
            Bursar is paused. Cycles still run and propose, but nothing executes, including approvals.
          </div>
        )}
        <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
