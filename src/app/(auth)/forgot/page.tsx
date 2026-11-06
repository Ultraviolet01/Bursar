import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/components/auth-flows";
import { devMailEnabled } from "@/lib/email";
import { requestReset } from "../actions";

export const metadata: Metadata = { title: "Reset password | Bursar" };
export const dynamic = "force-dynamic";

export default function Forgot() {
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Reset your password</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">Enter the email you sign in with. We send a link to choose a new password.</p>
      <ForgotForm action={requestReset} devInbox={devMailEnabled()} />
      <p className="mt-6 text-center text-[15px] text-muted">
        <Link href="/signin" className="font-medium text-teal hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
