// Same scheme as blaaiz-nodejs-sdk: hex HMAC-SHA256 of `${timestamp}.${rawBody}`.
import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(rawBody: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string, timestamp: string, secret: string): boolean {
  if (!rawBody || !signature || !timestamp || !secret) return false;
  try {
    const a = Buffer.from(signature.toLowerCase(), "hex");
    const b = Buffer.from(signWebhook(rawBody, timestamp, secret), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
