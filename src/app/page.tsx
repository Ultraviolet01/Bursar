import Link from "next/link";
import { HeroShip } from "@/components/hero-ship";
import { Reveal } from "@/components/interactive";
import { ThemeToggle } from "@/components/theme-toggle";

const GITHUB = "https://github.com/ultraviolet01/bursar";

const RULES = [
  { what: "Pay an allowlisted payee under your caps", who: "Alone", tone: "text-[#7FD1A8]" },
  { what: "Swap between currencies", who: "Asks you", tone: "text-[#E6B65C]" },
  { what: "Pay someone it has never paid", who: "Asks you", tone: "text-[#E6B65C]" },
  { what: "Pay over a per-payment or daily cap", who: "Asks you", tone: "text-[#E6B65C]" },
  { what: "Spend a wallet's buffer", who: "Asks you", tone: "text-[#E6B65C]" },
  { what: "Move money while paused", who: "Never", tone: "text-[#F08F7E]" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-5 sm:px-8">
          <Link href="/" className="display text-[22px] tracking-[0.08em] text-ink">BURSAR</Link>
          <nav className="flex items-center gap-5 text-sm text-body sm:gap-8">
            <a href="#how" className="nav-link hidden sm:inline">How it works</a>
            <a href="#line" className="nav-link hidden sm:inline">Your line</a>
            <a href={`${GITHUB}#readme`} className="nav-link hidden sm:inline">Docs</a>
            <a href={GITHUB} className="nav-link hidden sm:inline">GitHub</a>
            <ThemeToggle className="hidden sm:inline-flex" />
            <Link href="/signin" className="nav-link">Sign in</Link>
            <Link href="/app" className="pill-outline">Open app</Link>
          </nav>
        </div>
      </header>

      <main id="main">
      <section className="mx-auto max-w-[1200px] px-4 pb-10 pt-12 sm:px-8 sm:pt-16">
        <h1 className="display rise text-[52px] leading-[0.98] text-ink sm:text-[84px]">
          <span>Runs your treasury.</span>
          <br />
          <span style={{ animationDelay: "140ms" }}>Never past your line</span>
        </h1>
        <div className="mt-8 flex animate-page flex-col gap-6 [animation-delay:280ms] lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-[560px] text-[17px] leading-relaxed text-body">
            Bursar is a treasury agent for your company. It pays salaries, vendors and bills on its own, proposes a currency swap when a wallet runs short, and stops at the line you draw.
          </p>
          <div className="flex gap-3">
            <Link href="/signup" className="pill-primary">Get started</Link>
            <a href="#how" className="pill-outline">See how it works</a>
          </div>
        </div>
      </section>

      <section className="animate-fade overflow-x-hidden [animation-delay:200ms]" aria-label="Animation: a ship and its load line">
        <HeroShip />
      </section>

      <section id="how" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8 sm:py-28">
        <Reveal><h2 className="display text-[44px] text-ink sm:text-[52px]">How it works</h2></Reveal>
        <div className="mt-12 grid gap-12 md:grid-cols-3">
          {[
            ["Draw your line", "Set caps per payment and per day, a buffer for each wallet, and which swaps are allowed. Only you can change them."],
            ["Bursar keeps watch", "It forecasts every wallet 14 days ahead. When a bill is due it pays it, or holds a bill that can wait. If a currency is short, it proposes a swap."],
            ["You sign the big ones", "Every swap, and anything over your line, waits in your inbox with Bursar's reasons and the live rule checks attached."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 120} className="group">
              <div className="display text-[56px] leading-none text-teal transition-transform duration-300 group-hover:-translate-y-1">{i + 1}</div>
              <h3 className="mt-6 text-[18px] font-medium text-ink">{t}</h3>
              <p className="mt-3 max-w-[320px] text-[15px] leading-relaxed text-muted">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="line" className="bg-navy text-white">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <h2 className="display text-[44px] leading-[1.05] sm:text-[56px]">Every payment
              <br />checks your line first</h2>
            <p className="mt-6 max-w-[480px] text-[16px] leading-relaxed text-white/70">
              Bursar decides with fixed, tested rules. A separate policy engine checks every payment and swap against your limits, then checks again with live balances right before Blaaiz is called. No AI model can authorise a payment.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="text-sm text-white/60">What Bursar may do on its own</div>
            <div className="mt-4 divide-y divide-navy-line border-y border-navy-line">
              {RULES.map((r) => (
                <div key={r.what} className="flex items-center justify-between gap-6 py-3.5 transition-colors hover:bg-white/5">
                  <span className="text-[15px] text-white/90">{r.what}</span>
                  <span className={`whitespace-nowrap text-sm ${r.tone}`}>{r.who}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bg-sea-light">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="display text-[44px] text-ink sm:text-[64px]">Give your treasury a bursar</h2>
            <div className="mt-8 flex gap-3">
              <Link href="/signup" className="pill-primary">Get started</Link>
              <a href={`${GITHUB}#readme`} className="pill-outline">Read the docs</a>
            </div>
          </Reveal>
        </div>
      </section>

      </main>
      <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-8">
        <span>Built on Blaaiz for the Blaaiz Buildathon</span>
        <a href={GITHUB} className="nav-link">Source on GitHub</a>
      </footer>
    </div>
  );
}
