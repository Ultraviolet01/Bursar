// GET /auth/google/callback: finish "Continue with Google".
// Matches an existing founder by Google id, then by verified email; otherwise creates one.
import { NextResponse, type NextRequest } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { appUrl, exchangeCode, verifyIdToken } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = appUrl(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), req.headers.get("x-forwarded-proto"));
  const fail = (code: string) => {
    const res = NextResponse.redirect(`${base}/signin?error=${code}`);
    res.cookies.delete({ name: "bursar_oauth", path: "/auth/google" });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("google_cancelled");
  let saved: { state: string; nonce: string; verifier: string; next: string };
  try {
    saved = JSON.parse(req.cookies.get("bursar_oauth")?.value ?? "");
  } catch {
    return fail("google_expired");
  }
  if (!saved.state || params.get("state") !== saved.state) return fail("google_state");

  let profile;
  try {
    const idToken = await exchangeCode(params.get("code") ?? "", saved.verifier, `${base}/auth/google/callback`);
    profile = await verifyIdToken(idToken, { nonce: saved.nonce });
  } catch {
    return fail("google_failed");
  }
  if (!profile.emailVerified) return fail("google_unverified");

  let user = await db.user.findUnique({ where: { googleSub: profile.sub } });
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email: profile.email } });
    user = byEmail
      ? await db.user.update({ where: { id: byEmail.id }, data: { googleSub: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } })
      : await db.user.create({ data: { email: profile.email, name: profile.name, googleSub: profile.sub, emailVerifiedAt: new Date() } });
  }

  const first = await db.company.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } });
  await createSession(user.id, first?.id);
  await setFlash(`Signed in with Google as ${user.email}.`, "teal");
  const res = NextResponse.redirect(`${base}${first ? (saved.next.startsWith("/app") ? saved.next : "/app") : "/onboarding"}`);
  res.cookies.delete({ name: "bursar_oauth", path: "/auth/google" });
  return res;
}
