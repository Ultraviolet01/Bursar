// One Blaaiz client per company. BLAAIZ_MODE picks live or mock for the whole deployment;
// in live mode each company brings its own Blaaiz business credentials.
import { db } from "../lib/db";
import { env } from "../lib/env";
import { decryptSecret } from "../lib/crypto";
import type { BlaaizClient } from "./client";
import { LiveBlaaizClient } from "./live";
import { MockBlaaizClient } from "./mock";

export type { BlaaizClient } from "./client";

const g = globalThis as unknown as { __bursarBlaaiz?: Map<string, BlaaizClient> };
const cache = (g.__bursarBlaaiz ??= new Map());

/** Webhook signing secret for a company: its own in live mode, the env one in mock mode. */
export async function webhookSecretFor(companyId: string): Promise<string> {
  if (env.mode === "mock") return env.webhookSecret;
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  return c.blaaizWebhookSecretEnc ? decryptSecret(c.blaaizWebhookSecretEnc) : env.webhookSecret;
}

export async function getBlaaiz(companyId: string): Promise<BlaaizClient> {
  const hit = cache.get(companyId);
  if (hit) return hit;
  let client: BlaaizClient;
  if (env.mode === "live") {
    const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    client = new LiveBlaaizClient({
      clientId: c.blaaizClientId || env.clientId,
      clientSecret: c.blaaizClientSecretEnc ? decryptSecret(c.blaaizClientSecretEnc) : env.clientSecret,
      oauthScope: env.oauthScope,
      baseURL: env.apiUrl,
      webhookSecret: await webhookSecretFor(companyId),
    });
  } else {
    client = new MockBlaaizClient(db, {
      companyId,
      webhookSecret: env.webhookSecret,
      // Mock webhooks go through the same handler as real ones.
      sink: async (raw, sig, ts) => (await import("../webhooks/handler")).handleBlaaizWebhook(companyId, raw, sig, ts),
    });
  }
  cache.set(companyId, client);
  return client;
}

/** Drop a cached client after credentials change. */
export function forgetBlaaiz(companyId: string) {
  cache.delete(companyId);
}

/** Tests inject their own client. */
export function setBlaaiz(companyId: string, client: BlaaizClient) {
  cache.set(companyId, client);
}
