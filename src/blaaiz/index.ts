// Picks the live or mock client from BLAAIZ_MODE.
import { db } from "../lib/db";
import { env } from "../lib/env";
import type { BlaaizClient } from "./client";
import { LiveBlaaizClient } from "./live";
import { MockBlaaizClient } from "./mock";

export type { BlaaizClient } from "./client";

const g = globalThis as unknown as { __bursarBlaaiz?: BlaaizClient };

export function getBlaaiz(): BlaaizClient {
  if (g.__bursarBlaaiz) return g.__bursarBlaaiz;
  const client: BlaaizClient =
    env.mode === "live"
      ? new LiveBlaaizClient({
          clientId: env.clientId,
          clientSecret: env.clientSecret,
          oauthScope: env.oauthScope,
          baseURL: env.apiUrl,
          webhookSecret: env.webhookSecret,
        })
      : new MockBlaaizClient(db, {
          webhookSecret: env.webhookSecret,
          // Mock webhooks go through the same handler as real ones.
          sink: async (raw, sig, ts) => (await import("../webhooks/handler")).handleBlaaizWebhook(raw, sig, ts),
        });
  g.__bursarBlaaiz = client;
  return client;
}
