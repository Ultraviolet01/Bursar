// Demo data: one founder who runs two companies. Safe to re-run: wipes first.
// Locally, sign in as founder@bursar.demo with the test sign-in (ENABLE_TEST_LOGIN=1).
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/crypto";
import { createDemoCompany, createSecondDemoCompany } from "../src/lib/companies";

const db = new PrismaClient();
export const DEMO_EMAIL = "founder@bursar.demo";
export const DEMO_PASSWORD = "bursar-demo";

async function main() {
  await db.$transaction([
    db.execution.deleteMany(),
    db.action.deleteMany(),
    db.cycle.deleteMany(),
    db.scheduledPayment.deleteMany(),
    db.payee.deleteMany(),
    db.walletSnapshot.deleteMany(),
    db.wallet.deleteMany(),
    db.rateSnapshot.deleteMany(),
    db.webhookEvent.deleteMany(),
    db.auditLog.deleteMany(),
    db.policy.deleteMany(),
    db.company.deleteMany(),
    db.session.deleteMany(),
    db.authToken.deleteMany(),
    db.devEmail.deleteMany(),
    db.user.deleteMany(),
    db.mockTransaction.deleteMany(),
    db.mockWallet.deleteMany(),
  ]);
  const user = await db.user.create({ data: { email: DEMO_EMAIL, name: "David Babatunde", passwordHash: hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date() } });
  const a = await createDemoCompany(db, user.id);
  const b = await createSecondDemoCompany(db, user.id);
  console.log(`Seeded ${a.name} and ${b.name} for ${DEMO_EMAIL}.`);
}

main().finally(() => db.$disconnect());
