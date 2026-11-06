import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth-flows";
import { peekToken } from "@/lib/tokens";
import { resetPassword } from "../actions";

export const metadata: Metadata = { title: "Choose a new password | Bursar" };
export const dynamic = "force-dynamic";

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const row = await peekToken("RESET", token);
  if (!row) {
    return (
      <>
        <h1 className="display text-[40px] leading-tight text-ink">Link expired</h1>
        <p className="mb-8 mt-2 text-[16px] text-muted">Reset links work once and expire after 30 minutes.</p>
        <Link href="/forgot" className="btn-primary">Send a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">Choose a new password</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">For {row.email}</p>
      <ResetForm action={resetPassword} token={token} />
    </>
  );
}
