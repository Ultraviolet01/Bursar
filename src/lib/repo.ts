// Maps database rows to engine types. BigInt minor units become plain numbers here.
import type { Payee, Policy, PrismaClient, ScheduledPayment } from "@prisma/client";
import { bn, type Currency } from "./money";
import type { Category, PayeeInfo, PaymentInfo, PolicyConfig } from "../engine/types";

export function toPolicyConfig(p: Policy): PolicyConfig {
  const caps = JSON.parse(p.perPaymentCap) as Record<Currency, number>;
  const buffer = JSON.parse(p.buffer) as Record<Currency, number>;
  return {
    perPaymentCap: caps,
    dailyCapNgn: bn(p.dailyCapNgn),
    perSwapCapNgn: bn(p.perSwapCapNgn),
    buffer,
    allowedPairs: p.allowedPairs.split(",").map((s) => s.trim()).filter(Boolean),
    maxRateDeviationPct: p.maxRateDeviationPct,
    horizonDays: p.horizonDays,
    maxDeferDays: p.maxDeferDays,
    autoExecute: p.autoExecute,
  };
}

export async function loadPolicy(db: PrismaClient, companyId: string): Promise<PolicyConfig> {
  return toPolicyConfig(await db.policy.findUniqueOrThrow({ where: { companyId } }));
}

export function toPayeeInfo(p: Payee): PayeeInfo {
  return {
    id: p.id,
    name: p.name,
    category: p.category as Category,
    currency: p.currency as Currency,
    allowlisted: p.allowlisted,
    critical: p.critical,
  };
}

export function toPaymentInfo(p: ScheduledPayment & { payee: Payee }): PaymentInfo {
  return {
    id: p.id,
    payee: toPayeeInfo(p.payee),
    amount: bn(p.amount),
    currency: p.currency as Currency,
    dueDate: p.dueDate,
    priority: p.priority,
    critical: p.critical,
    status: p.status,
    deferCount: p.deferCount,
    merchantReference: p.merchantReference,
  };
}

export async function getCompany(db: PrismaClient, companyId: string) {
  return db.company.findUniqueOrThrow({ where: { id: companyId } });
}

export async function nextActionNumber(db: PrismaClient, companyId: string): Promise<number> {
  const last = await db.action.findFirst({ where: { companyId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

export async function audit(db: PrismaClient, companyId: string | null, actor: "BURSAR" | "OWNER" | "BLAAIZ", message: string, refType?: string, refId?: string) {
  await db.auditLog.create({ data: { companyId, actor, message, refType, refId } });
}

/** Default rules from the spec, used for every new company. */
export function defaultPolicy(companyId: string) {
  return {
    companyId,
    perPaymentCap: JSON.stringify({ NGN: 200_000_000, USD: 150_000 }),
    dailyCapNgn: 500_000_000n,
    perSwapCapNgn: 300_000_000n,
    buffer: JSON.stringify({ NGN: 30_000_000, USD: 20_000 }),
    allowedPairs: "NGN>USD,USD>NGN",
    maxRateDeviationPct: 3,
    horizonDays: 14,
    maxDeferDays: 3,
    autoExecute: true,
  };
}

export function merchantReference(paymentId: string, dueDate: string) {
  return `bursar-${paymentId}-${dueDate}`;
}
