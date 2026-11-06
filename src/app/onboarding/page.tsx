import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyForm } from "@/components/company-form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { addCompany, signOut } from "../app/actions";

export const metadata: Metadata = { title: "Set up your company | Bursar" };
export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const session = await requireUser();
  if (await db.company.count({ where: { ownerId: session.userId } })) redirect("/app");
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line px-4 py-5 sm:px-8">
        <Link href="/" className="display text-[22px] tracking-[0.08em] text-ink">BURSAR</Link>
        <form action={signOut}><button className="btn-outline btn-sm">Sign out</button></form>
      </header>
      <main id="main" className="animate-page mx-auto max-w-[560px] px-4 py-12 sm:py-16">
        <p className="text-sm font-medium text-teal">Welcome, {session.user.name.split(" ")[0]}</p>
        <h1 className="display mt-2 text-[44px] leading-tight text-ink">Add your first company</h1>
        <p className="mb-8 mt-2 text-[16px] text-muted">You can add more companies later from the company menu in the sidebar.</p>
        <CompanyForm action={addCompany} mock={env.mode === "mock"} first />
      </main>
    </div>
  );
}
