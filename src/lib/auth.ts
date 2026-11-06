// Cookie sessions. The cookie holds a random token; the database stores only its hash.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { hashToken, newToken } from "./crypto";

export const SESSION_COOKIE = "bursar_session";
const THIRTY_DAYS = 30 * 86_400_000;

export async function createSession(userId: string, activeCompanyId?: string | null) {
  const token = newToken();
  await db.session.create({
    data: { id: hashToken(token), userId, activeCompanyId: activeCompanyId ?? null, expiresAt: new Date(Date.now() + THIRTY_DAYS) },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS / 1000,
  });
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session;
}

/** The signed-in founder, their companies, and the one they are working in. */
export async function requireCompany() {
  const session = await requireUser();
  const companies = await db.company.findMany({ where: { ownerId: session.userId }, orderBy: { createdAt: "asc" } });
  if (companies.length === 0) redirect("/onboarding");
  const company = companies.find((c) => c.id === session.activeCompanyId) ?? companies[0];
  return { session, user: session.user, companies, company };
}

export async function setActiveCompany(sessionId: string, companyId: string) {
  await db.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
}
