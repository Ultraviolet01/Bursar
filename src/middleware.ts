// Fast gate: no session cookie, no dashboard. The session itself is checked
// against the database in requireUser()/requireCompany().
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (!req.cookies.get("bursar_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = req.nextUrl.pathname.startsWith("/app") ? `?next=${encodeURIComponent(req.nextUrl.pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/onboarding"] };
