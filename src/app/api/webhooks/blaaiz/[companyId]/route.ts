// POST /api/webhooks/blaaiz/{companyId}. One URL per company, so each Blaaiz
// business account signs with its own secret. Reads the raw body for the HMAC check.
import { NextResponse } from "next/server";
import { handleBlaaizWebhook } from "@/webhooks/handler";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const raw = await req.text();
  const res = await handleBlaaizWebhook(companyId, raw, req.headers.get("x-blaaiz-signature"), req.headers.get("x-blaaiz-timestamp"));
  return NextResponse.json(res.body, { status: res.status });
}
