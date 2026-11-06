// GET /auth/verify?token=...: confirms a founder's email address.
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { setFlash } from "@/lib/flash";
import { appUrl, consumeToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = appUrl(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), req.headers.get("x-forwarded-proto"));
  const row = await consumeToken("VERIFY", req.nextUrl.searchParams.get("token") ?? "");
  if (!row?.userId) {
    await setFlash("That confirmation link has expired or was already used.", "amber");
    return NextResponse.redirect(`${base}/app`);
  }
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  await setFlash(`Email confirmed: ${row.email}.`, "good");
  return NextResponse.redirect(`${base}/app`);
}
