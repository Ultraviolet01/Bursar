import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanyForm } from "@/components/company-form";
import { OnboardingBackdrop } from "@/components/onboarding-backdrop";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { addCompany, signOut } from "../app/actions";

export const metadata: Metadata = { title: "Set up your company | Bursar" };
export const dynamic = "force-dynamic";

// The real interface sits blurred behind a dialog. Creating the company
// clears the blur and drops the founder into the live dashboard.
export default async function Onboarding() {
  const session = await requireUser();
  if (await db.company.count({ where: { ownerId: session.userId } })) redirect("/app");
  const first = session.user.name.split(" ")[0];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="onboarding-backdrop">
        <OnboardingBackdrop name={first} />
      </div>
      <div className="animate-fade fixed inset-0 z-40 bg-canvas/40" aria-hidden />

      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-4 py-10">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            aria-describedby="onboarding-desc"
            className="animate-dialog w-full max-w-[540px]"
          >
            <div className="rounded-3xl border border-line bg-surface/95 p-2 shadow-2xl backdrop-blur">
              <div className="px-6 pb-2 pt-6 sm:px-8">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-teal">Welcome, {first}</p>
                  <form action={signOut}>
                    <button className="rounded-md px-2 py-1 text-sm text-muted transition hover:bg-canvas hover:text-ink">Sign out</button>
                  </form>
                </div>
                <h1 id="onboarding-title" className="display mt-2 text-[38px] leading-tight text-ink">Add your first company</h1>
                <p id="onboarding-desc" className="mt-2 text-[16px] text-muted">
                  Bursar runs each company separately. You can add more later from the company menu in the sidebar.
                </p>
              </div>
              <CompanyForm action={addCompany} mock={env.mode === "mock"} first onboarding />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
