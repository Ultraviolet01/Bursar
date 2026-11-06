// One-time email links: sign-in, password reset and email confirmation.
// The raw token only ever lives in the emailed link; the database keeps its hash.
import { db } from "./db";
import { hashToken, newToken } from "./crypto";

export type TokenKind = "LOGIN" | "RESET" | "VERIFY";

const TTL_MIN: Record<TokenKind, number> = { LOGIN: 15, RESET: 30, VERIFY: 60 * 24 };
const MAX_PER_15_MIN = 3;

export class TooManyRequests extends Error {}

export async function issueToken(kind: TokenKind, email: string, userId?: string | null): Promise<string> {
  const recent = await db.authToken.count({ where: { email, kind, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
  if (recent >= MAX_PER_15_MIN) throw new TooManyRequests("Too many emails requested. Wait a few minutes and try again.");
  const token = newToken();
  await db.authToken.create({ data: { id: hashToken(token), kind, email, userId: userId ?? null, expiresAt: new Date(Date.now() + TTL_MIN[kind] * 60_000) } });
  return token;
}

/** Looks a token up without using it (for confirmation pages). */
export async function peekToken(kind: TokenKind, token: string) {
  const row = await db.authToken.findUnique({ where: { id: hashToken(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

/** Uses a token exactly once. Returns null if it is unknown, expired, used, or the wrong kind. */
export async function consumeToken(kind: TokenKind, token: string) {
  const row = await peekToken(kind, token);
  if (!row) return null;
  // Conditional update: only one caller can flip usedAt from null.
  const res = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return res.count === 1 ? row : null;
}

export function appUrl(fallbackHost?: string | null, proto?: string | null): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return `${proto ?? "http"}://${fallbackHost ?? "localhost:3000"}`;
}
