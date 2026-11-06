import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AUTH_ERRORS, Divider, GoogleButton } from "@/components/google-button";
import { getSession } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { signInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in | Bursar" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getSession()) redirect("/app");
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Sign in</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">Pick up where Bursar left off across all your companies.</p>
      {error && AUTH_ERRORS[error] && (
        <div role="alert" className="mb-6 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-[15px] text-bad">{AUTH_ERRORS[error]}</div>
      )}
      {googleEnabled() && (
        <>
          <GoogleButton next={next} />
          <Divider label="or with email" />
        </>
      )}
      <AuthForm mode="signin" action={signInAction} next={next} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[15px]">
        <Link href="/signin/link" className="font-medium text-teal hover:underline">Email me a sign-in link</Link>
        <Link href="/forgot" className="text-muted hover:text-ink hover:underline">Forgot password?</Link>
      </div>
      {process.env.BLAAIZ_MODE !== "live" && (
        <p className="mt-8 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          Demo account after <code className="font-mono">npm run db:seed</code>: <span className="font-mono text-ink">founder@bursar.demo</span> / <span className="font-mono text-ink">bursar-demo</span>
        </p>
      )}
    </>
  );
}
