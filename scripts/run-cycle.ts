// Runs one cycle from the command line, waits for mock webhooks, prints the result.
import { getBlaaiz } from "../src/blaaiz";
import { db } from "../src/lib/db";
import { runCycle } from "../src/engine/cycle";

async function main() {
  const client = getBlaaiz();
  const res = await runCycle(db, client, "MANUAL");
  console.log(`Cycle ${res.cycleId}: ${res.summary}`);
  if (client.mode === "mock") await new Promise((r) => setTimeout(r, 3500));
  const actions = await db.action.findMany({ where: { cycleId: res.cycleId }, orderBy: { number: "asc" } });
  for (const a of actions) console.log(`#${a.number} ${a.type.padEnd(13)} ${a.status.padEnd(9)} ${a.reasonCode.padEnd(22)} ${a.explanation}`);
  const pays = await db.scheduledPayment.findMany({ include: { payee: true }, orderBy: { dueDate: "asc" } });
  for (const p of pays) console.log(`  ${p.dueDate} ${p.payee.name.padEnd(22)} ${p.status}`);
  const w = await db.mockWallet.findMany();
  console.log(w.map((x) => `${x.currency} ${(Number(x.balance) / 100).toFixed(2)}`).join(" | "));
}

main().finally(() => db.$disconnect());
