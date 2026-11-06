import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Divider, GoogleButton } from "@/components/google-button";
import { getSession } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "Create account | Bursar" };

export default async function SignUp() {
  if (await getSession()) redirect("/app");
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Create your account</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">One login for every company you run. Any email works: Gmail, Outlook, your company domain.</p>
      {googleEnabled() && (
        <>
          <GoogleButton />
          <Divider label="or with email" />
        </>
      )}
      <AuthForm mode="signup" action={signUpAction} />
      <p className="mt-6 text-center text-[15px] text-muted">
        Rather not set a password? <Link href="/signin/link" className="font-medium text-teal hover:underline">Get an email link</Link>
      </p>
    </>
  );
}
