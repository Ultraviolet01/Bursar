import { generateKeyPairSync, sign } from "node:crypto";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { consumeToken, issueToken, peekToken, TooManyRequests } from "../src/lib/tokens";
import { newOAuthRequest, verifyIdToken } from "../src/lib/google";

beforeAll(() => {
  execSync("npx tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "ignore" });
});

describe("email link tokens", () => {
  it("work exactly once and only for their kind", async () => {
    const t = await issueToken("LOGIN", "once@example.com");
    expect(await peekToken("RESET", t)).toBeNull();
    expect(await peekToken("LOGIN", t)).not.toBeNull();
    const [a, b] = await Promise.all([consumeToken("LOGIN", t), consumeToken("LOGIN", t)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await consumeToken("LOGIN", t)).toBeNull();
  });

  it("store only a hash and expire", async () => {
    const t = await issueToken("RESET", "expire@example.com");
    expect(await db.authToken.count({ where: { id: t } })).toBe(0);
    await db.authToken.updateMany({ where: { email: "expire@example.com" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeToken("RESET", t)).toBeNull();
  });

  it("limit how many emails one address can trigger", async () => {
    for (let i = 0; i < 3; i++) await issueToken("LOGIN", "spam@example.com");
    await expect(issueToken("LOGIN", "spam@example.com")).rejects.toBeInstanceOf(TooManyRequests);
  });
});

describe("Google ID token verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = { keys: [{ ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256", use: "sig" }] };
  const now = Date.now();
  const make = (claims: Record<string, unknown>, kid = "k1") => {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "client-1", sub: "g-123", email: "Ada@Example.com", email_verified: true, name: "Ada Obi", nonce: "n1", exp: Math.floor(now / 1000) + 600, ...claims })).toString("base64url");
    const s = sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
    return `${h}.${p}.${s}`;
  };
  const opts = { nonce: "n1", clientId: "client-1", jwks, now };

  it("accepts a valid token and normalises the email", async () => {
    await expect(verifyIdToken(make({}), opts)).resolves.toMatchObject({ sub: "g-123", email: "ada@example.com", emailVerified: true, name: "Ada Obi" });
  });

  it("rejects a token for another app, a replayed nonce, an expired token or a forged signature", async () => {
    await expect(verifyIdToken(make({ aud: "someone-else" }), opts)).rejects.toThrow(/not issued for Bursar/);
    await expect(verifyIdToken(make({ nonce: "other" }), opts)).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(make({ exp: Math.floor(now / 1000) - 3600 }), opts)).rejects.toThrow(/expired/);
    await expect(verifyIdToken(make({ iss: "https://evil.example" }), opts)).rejects.toThrow(/issuer/);
    const [h, , s] = make({}).split(".");
    const forged = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "client-1", sub: "attacker", email: "x@y.z", nonce: "n1", exp: 9e9 })).toString("base64url");
    await expect(verifyIdToken(`${h}.${forged}.${s}`, opts)).rejects.toThrow(/signature/);
    await expect(verifyIdToken(make({}, "unknown"), opts)).rejects.toThrow(/Unknown signing key/);
  });

  it("builds an authorization request with PKCE, state and nonce", () => {
    process.env.GOOGLE_CLIENT_ID = "client-1";
    const r = newOAuthRequest("http://localhost:3000/auth/google/callback");
    const u = new URL(r.url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(r.state);
    expect(u.searchParams.get("nonce")).toBe(r.nonce);
    expect(u.searchParams.get("code_challenge")).not.toBe(r.verifier);
    expect(u.searchParams.get("scope")).toBe("openid email profile");
  });
});
