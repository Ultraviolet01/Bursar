import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/auth";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "Create account | Bursar" };

export default async function SignUp() {
  if (await getSession()) redirect("/app");
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Create your account</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">One login for every company you run.</p>
      <AuthForm mode="signup" action={signUpAction} />
    </>
  );
}
