import Link from "next/link";
import { formatMinor } from "@/lib/money";
import { CountUp } from "./interactive";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[52px]">{title}</h1>
        {subtitle && <p className="mt-2 text-[17px] text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export type Tone = "teal" | "amber" | "good" | "bad" | "grey";
const TONE: Record<Tone, string> = {
  teal: "bg-teal-soft text-teal",
  amber: "bg-amber-soft text-amber",
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  grey: "bg-chip text-muted",
};

export function Pill({ tone, children, dot = true }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium ${TONE[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-chip px-2 py-0.5 text-[13px] text-muted">{children}</span>;
}

/** Big serif amount with a small currency code, as in the reference screens. */
export function Amount({ minor, currency, size = "lg", decimals = true, animate = false }: { minor: number; currency: string; size?: "sm" | "md" | "lg" | "xl"; decimals?: boolean; animate?: boolean }) {
  const cls = { sm: "text-[24px]", md: "text-[32px]", lg: "text-[40px]", xl: "text-[44px] sm:text-[56px]" }[size];
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={`display num leading-none text-ink ${cls}`}>{animate ? <CountUp value={minor} decimals={decimals ? 2 : 0} /> : formatMinor(minor, { decimals })}</span>
      <span className="text-[15px] text-muted">{currency}</span>
    </span>
  );
}

export function StatCard({ label, children, foot, footTone }: { label: string; children: React.ReactNode; foot?: React.ReactNode; footTone?: "amber" | "bad" | "good" | "muted" }) {
  const tone = { amber: "text-amber", bad: "text-bad", good: "text-good", muted: "text-muted" }[footTone ?? "muted"];
  return (
    <div className="p-6">
      <div className="text-[15px] text-body">{label}</div>
      <div className="mt-3">{children}</div>
      {foot && <div className={`mt-3 text-sm ${tone}`}>{foot}</div>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[18px] font-medium text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[15px] font-medium text-teal hover:underline">
      {children}
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-6 py-8 text-center text-[15px] text-muted">{children}</div>;
}

export function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "amber" | "muted" }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3.5 text-[15px] first:border-t-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={`num min-w-0 max-w-full text-right [overflow-wrap:anywhere] ${tone === "amber" ? "text-amber" : "text-ink"}`}>{value}</span>
    </div>
  );
}
