import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmLinkForm } from "@/components/auth-flows";
import { db } from "@/lib/db";
import { peekToken } from "@/lib/tokens";
import { confirmLoginLink } from "../../actions";

export const metadata: Metadata = { title: "Confirm sign-in | Bursar" };
export const dynamic = "force-dynamic";

export default async function ConfirmLink({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const row = await peekToken("LOGIN", token);
  if (!row) {
    return (
      <>
        <h1 className="display text-[40px] leading-tight text-ink">Link expired</h1>
        <p className="mb-8 mt-2 text-[16px] text-muted">Sign-in links work once and expire after 15 minutes.</p>
        <Link href="/signin/link" className="btn-primary">Send a new link</Link>
      </>
    );
  }
  const isNew = !(await db.user.findUnique({ where: { email: row.email } }));
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">{isNew ? "Create your account" : "Welcome back"}</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">{isNew ? "One step: tell us your name." : "Confirm it is you to finish signing in."}</p>
      <ConfirmLinkForm action={confirmLoginLink} token={token} email={row.email} isNew={isNew} />
    </>
  );
}
