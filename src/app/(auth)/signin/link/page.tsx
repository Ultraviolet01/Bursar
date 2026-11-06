import type { Metadata } from "next";
import Link from "next/link";
import { LoginLinkForm } from "@/components/auth-flows";
import { devMailEnabled } from "@/lib/email";
import { requestLoginLink } from "../../actions";

export const metadata: Metadata = { title: "Email sign-in link | Bursar" };
export const dynamic = "force-dynamic";

export default function LoginLink() {
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Sign in by email</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">We email you a link that signs you in. No password needed. New here? The same link creates your account.</p>
      <LoginLinkForm action={requestLoginLink} devInbox={devMailEnabled()} />
      <p className="mt-6 text-center text-[15px] text-muted">
        <Link href="/signin" className="font-medium text-teal hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
