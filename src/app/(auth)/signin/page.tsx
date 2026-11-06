import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/auth";
import { signInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in | Bursar" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/app");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Sign in</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">Pick up where Bursar left off across all your companies.</p>
      <AuthForm mode="signin" action={signInAction} next={next} />
      {process.env.BLAAIZ_MODE !== "live" && (
        <p className="mt-8 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          Demo account after <code className="font-mono">npm run db:seed</code>: <span className="font-mono text-ink">founder@bursar.demo</span> / <span className="font-mono text-ink">bursar-demo</span>
        </p>
      )}
    </>
  );
}
