// GET /api/export downloads the active company's report as an Excel workbook
// (Summary, Activity, Payments, Ledger, Wallets). ?format=csv gives the activity as CSV.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ProposedAction } from "@/engine/types";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const company =
    (session.activeCompanyId && (await db.company.findFirst({ where: { id: session.activeCompanyId, ownerId: session.userId } }))) ||
    (await db.company.findFirst({ where: { ownerId: session.userId }, orderBy: { createdAt: "asc" } }));
  if (!company) return NextResponse.json({ error: "No company" }, { status: 400 });
  if (new URL(req.url).searchParams.get("format") !== "csv") {
    const { buildWorkbook } = await import("@/lib/export-xlsx");
    const { buffer, filename } = await buildWorkbook(company.id);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  const actions = await db.action.findMany({ where: { companyId: company.id }, orderBy: { number: "asc" }, include: { executions: true } });
  const lines = [["number", "created_at", "type", "status", "decided_by", "currency", "amount", "fee", "reason_code", "explanation", "blaaiz_refs"].join(",")];
  for (const a of actions) {
    const p = JSON.parse(a.payload) as ProposedAction;
    lines.push(
      [a.number, a.createdAt.toISOString(), a.type, a.status, a.decidedBy ?? "", p.currency, (p.amount / 100).toFixed(2), (p.fee / 100).toFixed(2), a.reasonCode, a.explanation, a.executions.map((e) => e.blaaizTransactionId).filter(Boolean).join(" ")]
        .map(esc)
        .join(","),
    );
  }
  const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="bursar-${slug}-activity.csv"` },
  });
}
