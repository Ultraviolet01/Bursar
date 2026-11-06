// POST /api/cycle
//  - Signed in: runs a cycle for your active company.
//  - Authorization: Bearer $CRON_SECRET: runs every company (external schedulers).
import { NextResponse } from "next/server";
import { getBlaaiz } from "@/blaaiz";
import { runCycle } from "@/engine/cycle";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  let companyIds: string[] = [];
  if (cron) {
    companyIds = (await db.company.findMany({ select: { id: true } })).map((c) => c.id);
  } else {
    const session = await getSession();
    if (!session) return NextResponse.json({ ok: false, error: "Sign in or send the cron secret" }, { status: 401 });
    const company =
      (session.activeCompanyId && (await db.company.findFirst({ where: { id: session.activeCompanyId, ownerId: session.userId } }))) ||
      (await db.company.findFirst({ where: { ownerId: session.userId }, orderBy: { createdAt: "asc" } }));
    if (!company) return NextResponse.json({ ok: false, error: "No company yet" }, { status: 400 });
    companyIds = [company.id];
  }
  const results = [];
  for (const id of companyIds) {
    try {
      results.push({ companyId: id, ok: true, ...(await runCycle(db, await getBlaaiz(id), id, cron ? "SCHEDULE" : "MANUAL")) });
    } catch (e) {
      results.push({ companyId: id, ok: false, error: String(e) });
    }
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
