// GET /auth/google: start "Continue with Google".
import { NextResponse, type NextRequest } from "next/server";
import { appUrl, googleEnabled, newOAuthRequest } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = appUrl(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), req.headers.get("x-forwarded-proto"));
  if (!googleEnabled()) return NextResponse.redirect(`${base}/signin?error=google_off`);
  const next = req.nextUrl.searchParams.get("next") ?? "";
  const r = newOAuthRequest(`${base}/auth/google/callback`);
  const res = NextResponse.redirect(r.url);
  res.cookies.set("bursar_oauth", JSON.stringify({ state: r.state, nonce: r.nonce, verifier: r.verifier, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/google",
    maxAge: 600,
  });
  return res;
}
