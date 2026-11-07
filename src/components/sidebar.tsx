"use client";
// Fixed sidebar on desktop, slide-in drawer on small screens. Holds the
// company switcher, navigation, the running/paused card and sign out.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconCalendar, IconCog, IconGrid, IconInbox, IconList, IconMenu, IconPause, IconPlay, IconSliders, IconUsers, IconWallet, IconX } from "./icons";
import { SubmitButton } from "./interactive";
import { ThemeToggle } from "./theme-toggle";

const ITEMS = [
  { href: "/app", label: "Overview", Icon: IconGrid },
  { href: "/app/approvals", label: "Approvals", Icon: IconInbox, badge: true },
  { href: "/app/payments", label: "Payments", Icon: IconCalendar },
  { href: "/app/payees", label: "Payees", Icon: IconUsers },
  { href: "/app/activity", label: "Activity", Icon: IconList },
  { href: "/app/rules", label: "Rules", Icon: IconSliders },
  { href: "/app/wallets", label: "Wallets", Icon: IconWallet },
  { href: "/app/settings", label: "Settings", Icon: IconCog },
];

type Action = (formData: FormData) => void | Promise<void>;

export interface SidebarProps {
  companies: { id: string; name: string; customerId: string | null }[];
  activeId: string;
  mode: "mock" | "live";
  pending: number;
  paused: boolean;
  checked: string;
  user: { name: string; email: string };
  actions: { switchCompany: Action; togglePause: Action; signOut: Action };
}

function Chevrons() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-faint" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />
    </svg>
  );
}

function CompanySwitcher({ companies, activeId, mode, switchCompany }: { companies: SidebarProps["companies"]; activeId: string; mode: string; switchCompany: Action }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = companies.find((c) => c.id === activeId)!;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="group w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition hover:border-faint hover:shadow-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[15px] font-medium text-ink">{active.name}</span>
          <span className="flex items-center gap-2">
            <span className="rounded-md bg-chip px-2 py-0.5 text-xs text-muted">{mode === "mock" ? "Mock" : "Sandbox"}</span>
            <Chevrons />
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[13px] text-muted">{active.customerId ?? "No Blaaiz customer yet"}</div>
        <span className="sr-only">Switch company</span>
      </button>
      {open && (
        <div className="animate-pop absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted">Your companies</div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {companies.map((c) => (
              <li key={c.id}>
                <form action={switchCompany}>
                  <input type="hidden" name="companyId" value={c.id} />
                  <button
                    type="submit"
                    aria-current={c.id === activeId ? "true" : undefined}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[15px] text-ink transition hover:bg-canvas"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.id === activeId && <span className="text-sm text-teal">Current</span>}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <Link href="/app/companies/new" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-3 text-[15px] font-medium text-teal transition hover:bg-teal-tint">
            + Add a company
          </Link>
        </div>
      )}
    </div>
  );
}

function NavList({ pending, onNavigate }: { pending: number; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, Icon, badge }) => {
        const active = href === "/app" ? path === "/app" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[16px] transition-all duration-200 ${
              active ? "border-line bg-surface text-ink shadow-sm" : "border-transparent text-body hover:translate-x-0.5 hover:bg-surface/70"
            }`}
          >
            <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-teal transition-all duration-300 ${active ? "opacity-100" : "scale-y-0 opacity-0"}`} aria-hidden />
            <Icon className={`h-5 w-5 transition-colors ${active ? "text-teal" : "text-muted group-hover:text-ink"}`} />
            <span>{label}</span>
            {badge && pending > 0 && (
              <span className="animate-badge ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-dot px-1.5 text-xs font-semibold text-ink" aria-label={`${pending} waiting`}>
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody(props: SidebarProps & { onNavigate?: () => void }) {
  const { paused, checked, actions, user } = props;
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="display px-2 text-[30px] tracking-[0.08em] text-ink transition-opacity hover:opacity-80">
        BURSAR
      </Link>
      <div className="mt-7">
        <CompanySwitcher companies={props.companies} activeId={props.activeId} mode={props.mode} switchCompany={actions.switchCompany} />
      </div>
      <div className="mt-6">
        <NavList pending={props.pending} onNavigate={props.onNavigate} />
      </div>
      <div className="mt-auto space-y-3 pt-6">
        <div className="rounded-2xl bg-navy p-5 text-white">
          <div className="flex items-center gap-2.5 text-[16px] font-medium">
            <span className="relative flex h-2 w-2">
              {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3DB37A] opacity-60" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${paused ? "bg-amber-dot" : "bg-[#3DB37A]"}`} />
            </span>
            {paused ? "Bursar is paused" : "Bursar is running"}
          </div>
          <p className="mt-2 text-sm text-white/75">{paused ? "Proposals only. Nothing executes until you resume." : checked}</p>
          <form action={actions.togglePause} className="mt-4">
            <SubmitButton
              pendingText={paused ? "Resuming" : "Pausing"}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-navy-line bg-navy-2 px-3 py-2.5 text-[15px] text-white transition hover:bg-navy-line active:scale-[0.98] disabled:opacity-70"
            >
              <span className="inline-flex items-center gap-2">
                {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
                {paused ? "Resume Bursar" : "Pause all payments"}
              </span>
            </SubmitButton>
          </form>
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="text-sm text-muted">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-1">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
          <form action={actions.signOut}>
            <SubmitButton pendingText="Signing out" className="btn-outline btn-sm shrink-0">Sign out</SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Desktop: fixed, never scrolls with the page */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[280px] overflow-y-auto border-r border-line bg-canvas px-4 py-8 lg:block" aria-label="Sidebar">
        <SidebarBody {...props} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink transition hover:bg-surface" aria-label="Open menu" aria-expanded={open} aria-controls="mobile-drawer">
          <IconMenu className="h-6 w-6" />
        </button>
        <Link href="/" className="display text-2xl tracking-[0.08em] text-ink">BURSAR</Link>
        <Link href="/app/approvals" className="relative rounded-lg p-2 text-ink" aria-label={`Approvals, ${props.pending} waiting`}>
          <IconInbox className="h-6 w-6" />
          {props.pending > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-dot ring-2 ring-canvas" />}
        </Link>
      </div>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div className={`absolute inset-0 bg-navy/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(false)} />
        <div
          id="mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 w-[300px] max-w-[85vw] overflow-y-auto bg-canvas px-4 py-6 shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-muted hover:text-ink" aria-label="Close menu" tabIndex={open ? 0 : -1}>
            <IconX className="h-5 w-5" />
          </button>
          {open && <SidebarBody {...props} onNavigate={() => setOpen(false)} />}
        </div>
      </div>
    </>
  );
}
