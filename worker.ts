// node-cron scheduler. Run alongside the web app: npm run worker
import cron from "node-cron";
import { getBlaaiz } from "./src/blaaiz";
import { runCycle } from "./src/engine/cycle";
import { db } from "./src/lib/db";
import { env } from "./src/lib/env";

console.log(`Bursar worker: ${env.mode} mode, schedule "${env.cycleCron}"`);
cron.schedule(env.cycleCron, async () => {
  try {
    const res = await runCycle(db, getBlaaiz(), "SCHEDULE");
    console.log(`${new Date().toISOString()} cycle: ${res.summary}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} cycle failed:`, e);
  }
});
