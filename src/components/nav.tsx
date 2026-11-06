"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCalendar, IconCog, IconGrid, IconInbox, IconList, IconSliders, IconUsers, IconWallet } from "./icons";

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

export function Nav({ pending, compact = false }: { pending: number; compact?: boolean }) {
  const path = usePathname();
  return (
    <nav className={compact ? "flex gap-1 overflow-x-auto px-4 pb-3" : "flex flex-col gap-1"}>
      {ITEMS.map(({ href, label, Icon, badge }) => {
        const active = href === "/app" ? path === "/app" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-[16px] ${
              active ? "border-line bg-surface text-ink" : "border-transparent text-body hover:bg-surface/60"
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? "text-ink" : "text-muted"}`} />
            <span>{label}</span>
            {badge && pending > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-dot px-1.5 text-xs font-semibold text-white">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
