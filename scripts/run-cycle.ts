// Runs one cycle for every company (or the one named) and prints the result.
// Usage: npm run cycle            npm run cycle -- "Kaduna Freight Ltd"
import { getBlaaiz } from "../src/blaaiz";
import { db } from "../src/lib/db";
import { runCycle } from "../src/engine/cycle";
import { env } from "../src/lib/env";

async function main() {
  const name = process.argv[2];
  const companies = await db.company.findMany({ where: name ? { name } : {}, orderBy: { createdAt: "asc" } });
  for (const c of companies) {
    const res = await runCycle(db, await getBlaaiz(c.id), c.id, "MANUAL");
    console.log(`\n${c.name}: ${res.summary}`);
    if (env.mode === "mock") await new Promise((r) => setTimeout(r, 3500));
    const actions = await db.action.findMany({ where: { cycleId: res.cycleId }, orderBy: { number: "asc" } });
    for (const a of actions) console.log(`  #${a.number} ${a.type.padEnd(13)} ${a.status.padEnd(9)} ${a.reasonCode.padEnd(22)} ${a.explanation}`);
    const pays = await db.scheduledPayment.findMany({ where: { companyId: c.id }, include: { payee: true }, orderBy: { dueDate: "asc" } });
    for (const p of pays) console.log(`    ${p.dueDate} ${p.payee.name.padEnd(22)} ${p.status}`);
  }
}

main().finally(() => db.$disconnect());
