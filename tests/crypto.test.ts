import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, hashToken, newToken, verifyPassword } from "../src/lib/crypto";

describe("crypto", () => {
  it("hashes and verifies passwords with a per-user salt", () => {
    const a = hashPassword("correct horse");
    expect(verifyPassword("correct horse", a)).toBe(true);
    expect(verifyPassword("wrong", a)).toBe(false);
    expect(hashPassword("correct horse")).not.toBe(a);
  });

  it("stores only a hash of the session token", () => {
    const t = newToken();
    expect(t.length).toBeGreaterThan(40);
    expect(hashToken(t)).not.toContain(t);
  });

  it("round-trips encrypted secrets and detects tampering", () => {
    process.env.BURSAR_SECRET_KEY = "x".repeat(40);
    const enc = encryptSecret("client-secret-123");
    expect(enc).not.toContain("client-secret-123");
    expect(decryptSecret(enc)).toBe("client-secret-123");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
