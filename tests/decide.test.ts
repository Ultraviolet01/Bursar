import { describe, expect, it } from "vitest";
import { decide } from "../src/engine/decide";
import { M, TODAY, input, payment, policy } from "./fixtures";
import { addDays } from "../src/lib/dates";

describe("decide: spec demo (section 12)", () => {
  const payroll = [450_000, 600_000, 380_000].map((a, i) => payment({ name: `Emp ${i}`, amount: a, category: "PAYROLL" }));
  const contractor = payment({ name: "Designer", amount: 1_500, currency: "USD", category: "CRITICAL_VENDOR" });
  const saas = payment({ name: "Hosting", amount: 120, currency: "USD", category: "SAAS" });
  const domain = payment({ name: "Domain", amount: 25_000, category: "DOMAIN", due: addDays(TODAY, 5) });
  const newVendor = payment({ name: "New vendor", amount: 2_500_000, allowlisted: false });
  const res = decide(input({ payments: [saas, newVendor, contractor, domain, ...payroll] }));
  const by = (id: string) => res.actions.find((a) => a.paymentId === id);

  it("pays payroll first, automatically", () => {
    for (const p of payroll) expect(by(p.id)).toMatchObject({ type: "PAY", reasonCode: "ROUTINE_OK" });
    expect(res.actions.slice(0, 3).map((a) => a.paymentId)).toEqual(payroll.map((p) => p.id));
  });

  it("swaps NGN to USD for exactly the contractor shortfall, then pays", () => {
    const a = by(contractor.id)!;
    expect(a.type).toBe("SWAP_THEN_PAY");
    // USD 1,200 - buffer 200 = 1,000 available; needs 1,501 incl. fee.
    expect(a.swap).toMatchObject({ from: "NGN", to: "USD", amountType: "to", toAmount: M(501) });
  });

  it("covers the SaaS bill with a second swap because NGN still has surplus", () => {
    expect(by(saas.id)!.type).toBe("SWAP_THEN_PAY");
  });

  it("escalates the new vendor for NEW_PAYEE and OVER_PAYMENT_CAP", () => {
    const a = by(newVendor.id)!;
    expect(a.type).toBe("ESCALATE");
    expect(a.reasons).toEqual(expect.arrayContaining(["NEW_PAYEE", "OVER_PAYMENT_CAP"]));
  });

  it("leaves the domain renewal (due in 5 days) to the forecast", () => {
    expect(by(domain.id)).toBeUndefined();
  });

  it("never plans an automated action that breaches a buffer", () => {
    expect(res.balancesAfter.NGN).toBeGreaterThanOrEqual(M(300_000));
  });
});

describe("decide: each reason code", () => {
  it("ROUTINE_OK when funds and caps allow", () => {
    const p = payment({ amount: 1_000 });
    expect(decide(input({ payments: [p] })).actions[0]).toMatchObject({ type: "PAY", reasonCode: "ROUTINE_OK" });
  });

  it("NEW_PAYEE", () => {
    const p = payment({ amount: 1_000, allowlisted: false });
    expect(decide(input({ payments: [p] })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "NEW_PAYEE" });
  });

  it("OVER_PAYMENT_CAP", () => {
    const p = payment({ amount: 2_000_001 });
    expect(decide(input({ payments: [p] })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "OVER_PAYMENT_CAP" });
  });

  it("OVER_DAILY_CAP counts what was already paid today", () => {
    const p = payment({ amount: 1_000_000 });
    const res = decide(input({ payments: [p], todaySpentNgn: M(4_500_000) }));
    expect(res.actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "OVER_DAILY_CAP" });
  });

  it("OVER_DAILY_CAP within the same cycle", () => {
    const ps = [1_900_000, 1_900_000, 1_900_000].map((a) => payment({ amount: a, category: "PAYROLL" }));
    const res = decide(input({ payments: ps, ngn: 20_000_000 }));
    expect(res.actions.map((a) => a.type)).toEqual(["PAY", "PAY", "ESCALATE"]);
    expect(res.actions[2].reasonCode).toBe("OVER_DAILY_CAP");
  });

  it("SHORTFALL_NON_CRITICAL defers when no wallet can fund it", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS" });
    const res = decide(input({ payments: [p], usd: 300, ngn: 310_000 }));
    expect(res.actions[0]).toMatchObject({ type: "DEFER", reasonCode: "SHORTFALL_NON_CRITICAL" });
  });

  it("SHORTFALL_CRITICAL escalates", () => {
    const p = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [p], usd: 300, ngn: 310_000 }));
    expect(res.actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "SHORTFALL_CRITICAL" });
  });

  it("RATE_TOO_WIDE skips the swap", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS" });
    const res = decide(input({ payments: [p], usd: 300, market: { usdNgn: 1600, usdNgnAvg7d: 1500, swapFeeBps: 50 } }));
    expect(res.actions[0]).toMatchObject({ type: "DEFER", reasonCode: "RATE_TOO_WIDE" });
  });

  it("PAIR_NOT_ALLOWED blocks the swap", () => {
    const p = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [p], usd: 300, policy: policy({ allowedPairs: ["USD>NGN"] }) }));
    expect(res.actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "PAIR_NOT_ALLOWED" });
  });

  it("OVER_SWAP_CAP blocks a swap above the cap", () => {
    const p = payment({ amount: 1_400, currency: "USD", category: "SAAS" });
    const res = decide(input({ payments: [p], usd: 200, policy: policy({ perSwapCapNgn: M(1_000_000) }) }));
    expect(res.actions[0]).toMatchObject({ type: "DEFER", reasonCode: "OVER_SWAP_CAP" });
  });

  it("MAX_DEFER_REACHED escalates instead of deferring again", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS", due: addDays(TODAY, -3), status: "DEFERRED" });
    const res = decide(input({ payments: [p], usd: 300, ngn: 310_000 }));
    expect(res.actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "MAX_DEFER_REACHED" });
  });

  it("BELOW_BUFFER_FORECAST proposes a top-up swap for a future shortfall", () => {
    const p = payment({ amount: 900, currency: "USD", category: "SAAS", due: addDays(TODAY, 4) });
    const res = decide(input({ payments: [p], usd: 1_000 }));
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ type: "SWAP", reasonCode: "BELOW_BUFFER_FORECAST", currency: "USD" });
    expect(res.actions[0].swap).toMatchObject({ from: "NGN", to: "USD", toAmount: M(101) });
  });

  it("does not propose a second top-up while one is pending", () => {
    const p = payment({ amount: 900, currency: "USD", category: "SAAS", due: addDays(TODAY, 4) });
    expect(decide(input({ payments: [p], usd: 1_000, pendingTopUps: ["USD"] })).actions).toHaveLength(0);
  });

  it("ignores payments already proposed, executing or paid", () => {
    const ps = ["PROPOSED", "EXECUTING", "PAID"].map((status) => payment({ amount: 100, status }));
    expect(decide(input({ payments: ps })).actions).toHaveLength(0);
  });

  it("reserves funds so later payments see the reduced balance", () => {
    const a = payment({ amount: 400_000, category: "PAYROLL" });
    const b = payment({ amount: 400_000, category: "VENDOR" });
    const res = decide(input({ payments: [b, a], ngn: 1_000_000, usd: 200 }));
    expect(res.actions.find((x) => x.paymentId === a.id)!.type).toBe("PAY");
    expect(res.actions.find((x) => x.paymentId === b.id)!.type).toBe("DEFER");
  });
});
