// Maps database rows to engine types. BigInt minor units become plain numbers here.
import type { Payee, Policy, PrismaClient, ScheduledPayment } from "@prisma/client";
import { bn, type Currency } from "./money";
import type { Category, PayeeInfo, PaymentInfo, PolicyConfig } from "../engine/types";

// Spec defaults: NGN 2,000,000 / USD 1,500 per payment, buffers NGN 300,000 / USD 200.
// EUR and GBP follow the USD shape.
export const DEFAULT_CAPS: Record<Currency, number> = { NGN: 200_000_000, USD: 150_000, EUR: 140_000, GBP: 120_000 };
export const DEFAULT_BUFFERS: Record<Currency, number> = { NGN: 30_000_000, USD: 20_000, EUR: 20_000, GBP: 15_000 };
export const DEFAULT_PAIRS = "NGN>USD,USD>NGN,NGN>EUR,EUR>NGN,NGN>GBP,GBP>NGN";

export function toPolicyConfig(p: Policy): PolicyConfig {
  const caps = { ...DEFAULT_CAPS, ...(JSON.parse(p.perPaymentCap) as Partial<Record<Currency, number>>) };
  const buffer = { ...DEFAULT_BUFFERS, ...(JSON.parse(p.buffer) as Partial<Record<Currency, number>>) };
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
    perPaymentCap: JSON.stringify(DEFAULT_CAPS),
    dailyCapNgn: 500_000_000n,
    perSwapCapNgn: 300_000_000n,
    buffer: JSON.stringify(DEFAULT_BUFFERS),
    allowedPairs: DEFAULT_PAIRS,
    maxRateDeviationPct: 3,
    horizonDays: 14,
    maxDeferDays: 3,
    autoExecute: true,
  };
}

export function merchantReference(paymentId: string, dueDate: string) {
  return `bursar-${paymentId}-${dueDate}`;
}
