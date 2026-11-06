// node-cron scheduler. Runs a cycle for every company on the schedule: npm run worker
import cron from "node-cron";
import { getBlaaiz } from "./src/blaaiz";
import { runCycle } from "./src/engine/cycle";
import { db } from "./src/lib/db";
import { env } from "./src/lib/env";

console.log(`Bursar worker: ${env.mode} mode, schedule "${env.cycleCron}"`);
cron.schedule(env.cycleCron, async () => {
  const companies = await db.company.findMany();
  for (const c of companies) {
    try {
      const res = await runCycle(db, await getBlaaiz(c.id), c.id, "SCHEDULE");
      console.log(`${new Date().toISOString()} ${c.name}: ${res.summary}`);
    } catch (e) {
      console.error(`${new Date().toISOString()} ${c.name} cycle failed:`, e);
    }
  }
});
