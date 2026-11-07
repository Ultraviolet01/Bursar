// GET /auth/test-login?email=...&name=...  Test-only sign-in for the browser test and local
// development without Google. Off unless ENABLE_TEST_LOGIN=1, and always off on Vercel.
import { NextResponse, type NextRequest } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl, testLoginEnabled } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!testLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  const base = appUrl(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), req.headers.get("x-forwarded-proto"));
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new NextResponse("Bad email", { status: 400 });
  const name = req.nextUrl.searchParams.get("name")?.trim() || email.split("@")[0];
  const user = (await db.user.findUnique({ where: { email } })) ?? (await db.user.create({ data: { email, name, emailVerifiedAt: new Date() } }));
  const first = await db.company.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } });
  await createSession(user.id, first?.id);
  const next = req.nextUrl.searchParams.get("next") ?? "";
  return NextResponse.redirect(`${base}${first ? (next.startsWith("/app") ? next : "/app") : "/onboarding"}`);
}
