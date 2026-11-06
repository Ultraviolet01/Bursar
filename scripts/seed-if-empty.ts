// Runs the demo seed only on a brand-new database, so redeploys never wipe real data.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
async function main() {
  const users = await db.user.count();
  if (users > 0) {
    console.log(`Database already has ${users} user(s); skipping the demo seed.`);
    return;
  }
  console.log("Empty database: seeding the demo founder and companies.");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
main().finally(() => db.$disconnect());
