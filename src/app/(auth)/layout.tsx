import Link from "next/link";
import { IconLine } from "@/components/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <Link href="/" className="display text-[28px] tracking-[0.08em]">BURSAR</Link>
        <div className="mt-auto">
          <IconLine className="h-8 w-12 text-amber-dot" />
          <p className="display mt-6 text-[44px] leading-[1.05]">Runs your treasury.<br />Never past your line</p>
          <ul className="mt-8 space-y-3 text-[16px] text-white/80">
            <li>Pays salaries, vendors and bills from your Blaaiz wallets</li>
            <li>Swaps NGN and USD when a wallet runs short</li>
            <li>Asks you before anything over your line</li>
          </ul>
        </div>
        <div className="auth-waves pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-20" aria-hidden />
      </aside>
      <main id="main" className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="animate-page w-full max-w-[420px]">
          <Link href="/" className="display mb-10 block text-[26px] tracking-[0.08em] text-ink lg:hidden">BURSAR</Link>
          {children}
        </div>
      </main>
    </div>
  );
}
