// Single entry for Blaaiz webhooks, live or mock. Stores the raw event first,
// rejects bad signatures, and is idempotent per (event, transaction).
import { z } from "zod";
import { getBlaaiz } from "../blaaiz";
import { db } from "../lib/db";
import { audit } from "../lib/repo";
import { applyPayoutUpdate } from "../engine/reconcile";
import { syncWallets } from "../engine/observe";

const EventSchema = z
  .object({
    event: z.string().optional(),
    type: z.string().optional(),
    event_type: z.string().optional(),
    data: z.record(z.any()).optional(),
  })
  .passthrough();

export interface WebhookResult {
  status: number;
  body: { ok: boolean; message: string };
}

export async function handleBlaaizWebhook(rawBody: string, signature: string | null, timestamp: string | null): Promise<WebhookResult> {
  const client = getBlaaiz();
  const valid = !!signature && !!timestamp && client.verifyWebhook(rawBody, signature, timestamp);

  let parsed: z.infer<typeof EventSchema> | null = null;
  try {
    const r = EventSchema.safeParse(JSON.parse(rawBody));
    parsed = r.success ? r.data : null;
  } catch {
    parsed = null;
  }
  const eventType = parsed?.event ?? parsed?.type ?? parsed?.event_type ?? "unknown";
  const data = (parsed?.data ?? parsed ?? {}) as Record<string, unknown>;
  const txId = (data.transaction_id ?? data.id ?? null) as string | null;
  const ref = (data.merchant_reference ?? null) as string | null;
  const dedupeKey = `${eventType}:${txId ?? ref ?? ""}`;

  const row = await db.webhookEvent.create({
    data: { eventType, rawBody, signatureValid: valid, dedupeKey, relatedTransactionId: txId },
  });

  if (!valid) {
    await db.webhookEvent.update({ where: { id: row.id }, data: { note: "Rejected: invalid signature" } });
    await audit(db, "BLAAIZ", `Rejected webhook ${eventType}: invalid signature`, "WebhookEvent", row.id);
    return { status: 401, body: { ok: false, message: "Invalid signature" } };
  }

  const dup = await db.webhookEvent.findFirst({ where: { dedupeKey, processedAt: { not: null }, id: { not: row.id } } });
  if (dup) {
    await db.webhookEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), note: "Duplicate, ignored" } });
    return { status: 200, body: { ok: true, message: "Duplicate" } };
  }

  let note = "Ignored";
  if (eventType === "payout.initiated" || eventType === "payout.processing") {
    note = await applyPayoutUpdate(db, { transactionId: txId, merchantReference: ref, status: "PROCESSING" });
  } else if (eventType === "payout.completed") {
    note = await applyPayoutUpdate(db, { transactionId: txId, merchantReference: ref, status: "SUCCESSFUL" });
  } else if (eventType === "payout.failed") {
    note = await applyPayoutUpdate(db, { transactionId: txId, merchantReference: ref, status: "FAILED", reason: data.reason as string | undefined });
  } else if (eventType === "collection.completed" || eventType === "virtual_account.credited") {
    await syncWallets(db, client);
    await audit(db, "BLAAIZ", `Wallet funded (${eventType}). Balances refreshed.`, "WebhookEvent", row.id);
    note = "Wallets refreshed";
  }
  await db.webhookEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), note } });
  return { status: 200, body: { ok: true, message: note } };
}
