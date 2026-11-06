// POST /api/webhooks/blaaiz. Reads the raw body so the HMAC check sees the exact bytes.
import { NextResponse } from "next/server";
import { handleBlaaizWebhook } from "@/webhooks/handler";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const res = await handleBlaaizWebhook(raw, req.headers.get("x-blaaiz-signature"), req.headers.get("x-blaaiz-timestamp"));
  return NextResponse.json(res.body, { status: res.status });
}
