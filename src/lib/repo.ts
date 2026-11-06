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

export async function loadPolicy(db: PrismaClient): Promise<PolicyConfig> {
  return toPolicyConfig(await db.policy.findUniqueOrThrow({ where: { id: "default" } }));
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

export async function getCompany(db: PrismaClient) {
  return db.company.findFirstOrThrow();
}

export async function nextActionNumber(db: PrismaClient): Promise<number> {
  const last = await db.action.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

export async function audit(db: PrismaClient, actor: "BURSAR" | "OWNER" | "BLAAIZ", message: string, refType?: string, refId?: string) {
  await db.auditLog.create({ data: { actor, message, refType, refId } });
}

export function merchantReference(paymentId: string, dueDate: string) {
  return `bursar-${paymentId}-${dueDate}`;
}
