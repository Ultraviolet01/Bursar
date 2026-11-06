import { Sidebar } from "@/components/sidebar";
import { PageTransition, Toaster } from "@/components/interactive";
import { requireCompany } from "@/lib/auth";
import { getShell } from "@/lib/dashboard";
import { timeAgo } from "@/lib/dates";
import { readFlash } from "@/lib/flash";
import { signOut, switchCompany, togglePause } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, company, companies } = await requireCompany();
  const [{ pending, lastCycle, mode }, flash] = await Promise.all([getShell(company.id), readFlash()]);
  const paused = company.paused;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-[70] rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Sidebar
        companies={companies.map((c) => ({ id: c.id, name: c.name, customerId: c.blaaizCustomerId }))}
        activeId={company.id}
        mode={mode}
        pending={pending}
        paused={paused}
        checked={lastCycle ? `Checked ${timeAgo(lastCycle.startedAt)}` : "No cycle run yet"}
        user={{ name: user.name, email: user.email }}
        actions={{ switchCompany, togglePause, signOut }}
      />

      <div className="min-w-0 lg:pl-[280px]">
        {mode === "mock" && (
          <div className="border-b border-amber-line/60 bg-amber-card px-4 py-2.5 text-sm text-[#5C4718] sm:px-8">
            Mock mode. Balances, rates, payouts and webhooks are simulated. Set <code className="font-mono">BLAAIZ_MODE=live</code> to use the Blaaiz sandbox.
          </div>
        )}
        {paused && (
          <div className="border-b border-bad-line bg-bad-soft px-4 py-2.5 text-sm text-bad sm:px-8" role="status">
            {company.name} is paused. Cycles still run and propose, but nothing executes, including approvals.
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 py-8 outline-none sm:px-8 sm:py-10">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <Toaster flash={flash} />
    </div>
  );
}
