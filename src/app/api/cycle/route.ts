// POST /api/cycle runs one cycle. Used by the dashboard and external schedulers.
import { NextResponse } from "next/server";
import { getBlaaiz } from "@/blaaiz";
import { runCycle } from "@/engine/cycle";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const trigger = new URL(req.url).searchParams.get("trigger") === "schedule" ? "SCHEDULE" : "MANUAL";
  try {
    const res = await runCycle(db, getBlaaiz(), trigger);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
