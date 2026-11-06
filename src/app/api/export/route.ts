// GET /api/export downloads every action as CSV.
import { db } from "@/lib/db";
import type { ProposedAction } from "@/engine/types";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET() {
  const actions = await db.action.findMany({ orderBy: { number: "asc" }, include: { executions: true } });
  const lines = [["number", "created_at", "type", "status", "decided_by", "currency", "amount", "fee", "reason_code", "explanation", "blaaiz_refs"].join(",")];
  for (const a of actions) {
    const p = JSON.parse(a.payload) as ProposedAction;
    lines.push(
      [a.number, a.createdAt.toISOString(), a.type, a.status, a.decidedBy ?? "", p.currency, (p.amount / 100).toFixed(2), (p.fee / 100).toFixed(2), a.reasonCode, a.explanation, a.executions.map((e) => e.blaaizTransactionId).filter(Boolean).join(" ")]
        .map(esc)
        .join(","),
    );
  }
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="bursar-activity.csv"` },
  });
}
