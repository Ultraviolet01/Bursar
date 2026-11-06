import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Fresh throwaway database for every test run.
export default function setup() {
  for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "ignore" });
}
