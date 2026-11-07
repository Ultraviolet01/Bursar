// npm run blaaiz:check  -- read-only check of a live Blaaiz account, for the day the keys arrive.
// Uses BLAAIZ_CLIENT_ID, BLAAIZ_CLIENT_SECRET, BLAAIZ_API_URL from .env. Never pays or swaps.
import { LiveBlaaizClient } from "../src/blaaiz/live";

async function main() {
  const { BLAAIZ_CLIENT_ID: id, BLAAIZ_CLIENT_SECRET: secret, BLAAIZ_API_URL: url = "https://api-dev.blaaiz.com", BLAAIZ_OAUTH_SCOPE: scope } = process.env;
  if (!id || !secret) {
    console.error("Set BLAAIZ_CLIENT_ID and BLAAIZ_CLIENT_SECRET in .env first.");
    process.exit(1);
  }
  const client = new LiveBlaaizClient({ clientId: id, clientSecret: secret, oauthScope: scope, baseURL: url, webhookSecret: process.env.BLAAIZ_WEBHOOK_SECRET ?? "" });
  console.log(`Checking ${url}\n`);
  const checks = await client.diagnose();
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(18)} ${c.detail}`);
    if (c.fields?.length) console.log(`      fields: ${c.fields.join(", ")}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${failed ? `${failed} check(s) failed. See docs/GOING_LIVE.md.` : "All checks passed. Set BLAAIZ_MODE=live to switch Bursar over."}`);
  process.exit(failed ? 1 : 0);
}
main();
