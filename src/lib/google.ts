// "Continue with Google": OpenID Connect authorization code flow with PKCE,
// state and nonce. The ID token's signature is checked against Google's keys.
import { createHash, createPublicKey, randomBytes, verify as verifySig, type JsonWebKey } from "node:crypto";

export function googleEnabled() {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function newOAuthRequest(redirectUri: string) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`Google did not return an ID token${body.error ? ` (${body.error})` : ""}`);
  return body.id_token;
}

type Jwks = { keys: (JsonWebKey & { kid?: string })[] };
let cached: { at: number; jwks: Jwks } | null = null;

async function googleKeys(): Promise<Jwks> {
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.jwks;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error("Could not load Google's signing keys");
  cached = { at: Date.now(), jwks: (await res.json()) as Jwks };
  return cached.jwks;
}

/** Verifies an RS256 ID token: signature, issuer, audience, expiry and nonce. `jwks` is injectable for tests. */
export async function verifyIdToken(idToken: string, opts: { nonce: string; clientId?: string; jwks?: Jwks; now?: number }): Promise<GoogleProfile> {
  const [h, p, sig] = idToken.split(".");
  if (!h || !p || !sig) throw new Error("Malformed ID token");
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid?: string };
  if (header.alg !== "RS256") throw new Error("Unexpected token algorithm");
  const jwks = opts.jwks ?? (await googleKeys());
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");
  const ok = verifySig("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(sig, "base64url"));
  if (!ok) throw new Error("Bad token signature");

  const c = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const clientId = opts.clientId ?? process.env.GOOGLE_CLIENT_ID;
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("Wrong token issuer");
  if (c.aud !== clientId) throw new Error("Token was not issued for Bursar");
  if (typeof c.exp !== "number" || c.exp < now - 60) throw new Error("Token expired");
  if (c.nonce !== opts.nonce) throw new Error("Token nonce mismatch");
  if (typeof c.sub !== "string" || typeof c.email !== "string") throw new Error("Token is missing the account id or email");
  return { sub: c.sub, email: c.email.toLowerCase(), emailVerified: c.email_verified === true, name: typeof c.name === "string" ? c.name : c.email.split("@")[0] };
}

export function appUrl(fallbackHost?: string | null, proto?: string | null): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return `${proto ?? "http"}://${fallbackHost ?? "localhost:3000"}`;
}

/**
 * Test-only sign-in (for the browser test and local development without Google).
 * Needs ENABLE_TEST_LOGIN=1 and is always off on Vercel, whatever the variable says.
 */
export function testLoginEnabled() {
  return process.env.ENABLE_TEST_LOGIN === "1" && !process.env.VERCEL;
}
