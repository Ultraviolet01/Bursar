import { describe, expect, it } from "vitest";
import { decide } from "../src/engine/decide";
import { M, TODAY, input, market, payment, policy } from "./fixtures";
import { addDays } from "../src/lib/dates";

describe("decide: spec demo (section 12) in lifecycle order", () => {
  const payroll = [450_000, 600_000, 380_000].map((a, i) => payment({ name: `Emp ${i}`, amount: a, category: "PAYROLL" }));
  const contractor = payment({ name: "Designer", amount: 1_500, currency: "USD", category: "CRITICAL_VENDOR" });
  const saas = payment({ name: "Hosting", amount: 120, currency: "USD", category: "SAAS" });
  const domain = payment({ name: "Domain", amount: 25_000, category: "DOMAIN", due: addDays(TODAY, 5) });
  const newVendor = payment({ name: "New vendor", amount: 2_500_000, allowlisted: false });
  const res = decide(input({ payments: [saas, newVendor, contractor, domain, ...payroll] }));
  const by = (id: string) => res.actions.find((a) => a.paymentId === id);
  const types = res.actions.map((a) => a.type);

  it("1. pays payroll first from the NGN it already holds", () => {
    expect(res.actions.slice(0, 3).map((a) => a.paymentId)).toEqual(payroll.map((p) => p.id));
    for (const p of payroll) expect(by(p.id)).toMatchObject({ type: "PAY", reasonCode: "ROUTINE_OK" });
  });

  it("2. rebalances once: one NGN to USD swap covers every short USD bill", () => {
    const swaps = res.actions.filter((a) => a.type === "SWAP");
    expect(swaps).toHaveLength(1);
    // USD 1,200 - buffer 200 = 1,000 available; needs 1,501 + 121.
    expect(swaps[0]).toMatchObject({ reasonCode: "REBALANCE", currency: "USD", covers: [contractor.id, saas.id] });
    expect(swaps[0].swap).toMatchObject({ from: "NGN", to: "USD", amountType: "to", toAmount: M(622) });
  });

  it("3. pays the bills the swap funded, critical first, linked to the swap", () => {
    const swapAt = types.indexOf("SWAP");
    expect(by(contractor.id)).toMatchObject({ type: "PAY", after: swapAt });
    expect(by(saas.id)).toMatchObject({ type: "PAY", after: swapAt });
    expect(res.actions.indexOf(by(contractor.id)!)).toBeLessThan(res.actions.indexOf(by(saas.id)!));
  });

  it("5. escalates the new vendor last, for NEW_PAYEE and OVER_PAYMENT_CAP", () => {
    const a = by(newVendor.id)!;
    expect(a.type).toBe("ESCALATE");
    expect(a.reasons).toEqual(expect.arrayContaining(["NEW_PAYEE", "OVER_PAYMENT_CAP"]));
    expect(res.actions.indexOf(a)).toBe(res.actions.length - 1);
  });

  it("leaves the domain renewal (due in 5 days) to the forecast", () => {
    expect(by(domain.id)).toBeUndefined();
  });

  it("never plans an automated action that breaches a buffer", () => {
    expect(res.balancesAfter.NGN).toBeGreaterThanOrEqual(M(300_000));
    expect(res.balancesAfter.USD! - M(1_501 + 121)).toBeGreaterThanOrEqual(M(200));
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
    expect(decide(input({ payments: [p], todaySpentNgn: M(4_500_000) })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "OVER_DAILY_CAP" });
  });

  it("OVER_DAILY_CAP within the same cycle", () => {
    const ps = [1_900_000, 1_900_000, 1_900_000].map((a) => payment({ amount: a, category: "PAYROLL" }));
    const res = decide(input({ payments: ps, ngn: 20_000_000 }));
    expect(res.actions.map((a) => a.type)).toEqual(["PAY", "PAY", "ESCALATE"]);
    expect(res.actions[2].reasonCode).toBe("OVER_DAILY_CAP");
  });

  it("SHORTFALL_NON_CRITICAL defers when no wallet can fund it", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS" });
    expect(decide(input({ payments: [p], usd: 300, ngn: 310_000 })).actions[0]).toMatchObject({ type: "DEFER", reasonCode: "SHORTFALL_NON_CRITICAL" });
  });

  it("SHORTFALL_CRITICAL escalates", () => {
    const p = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    expect(decide(input({ payments: [p], usd: 300, ngn: 310_000 })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "SHORTFALL_CRITICAL" });
  });

  it("RATE_TOO_WIDE defers instead of swapping at a poor rate", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS" });
    expect(decide(input({ payments: [p], usd: 300, market: market({ USD: 1600 }, { USD: 1500 }) })).actions[0]).toMatchObject({ type: "DEFER", reasonCode: "RATE_TOO_WIDE" });
  });

  it("PAIR_NOT_ALLOWED blocks the swap", () => {
    const p = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    expect(decide(input({ payments: [p], usd: 300, policy: policy({ allowedPairs: ["USD>NGN"] }) })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "PAIR_NOT_ALLOWED" });
  });

  it("OVER_SWAP_CAP: a rebalance over the swap cap is still planned, flagged for the owner", () => {
    const p = payment({ amount: 1_400, currency: "USD", category: "SAAS" });
    const res = decide(input({ payments: [p], usd: 200, policy: policy({ perSwapCapNgn: M(1_000_000) }) }));
    expect(res.actions[0]).toMatchObject({ type: "SWAP", reasonCode: "REBALANCE", reasons: ["REBALANCE", "OVER_SWAP_CAP"] });
    expect(res.actions[1]).toMatchObject({ type: "PAY", paymentId: p.id, after: 0 });
  });

  it("MAX_DEFER_REACHED escalates instead of deferring again", () => {
    const p = payment({ amount: 500, currency: "USD", category: "SAAS", due: addDays(TODAY, -3), status: "DEFERRED" });
    expect(decide(input({ payments: [p], usd: 300, ngn: 310_000 })).actions[0]).toMatchObject({ type: "ESCALATE", reasonCode: "MAX_DEFER_REACHED" });
  });

  it("BELOW_BUFFER_FORECAST proposes a top-up swap for a future shortfall", () => {
    const p = payment({ amount: 900, currency: "USD", category: "SAAS", due: addDays(TODAY, 4) });
    const res = decide(input({ payments: [p], usd: 1_000 }));
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ type: "SWAP", reasonCode: "BELOW_BUFFER_FORECAST", currency: "USD" });
    expect(res.actions[0].swap).toMatchObject({ from: "NGN", to: "USD", toAmount: M(101) });
  });

  it("does not propose a second swap while one is waiting for the owner", () => {
    const p = payment({ amount: 900, currency: "USD", category: "SAAS", due: addDays(TODAY, 4) });
    expect(decide(input({ payments: [p], usd: 1_000, pendingSwaps: ["USD"] })).actions).toHaveLength(0);
  });

  it("WAITING_FOR_REBALANCE holds due bills while their rebalance waits for the owner", () => {
    const p = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [p], usd: 300, pendingSwaps: ["USD"] }));
    expect(res.actions).toEqual([expect.objectContaining({ type: "HOLD", reasonCode: "WAITING_FOR_REBALANCE", paymentId: p.id })]);
  });

  it("after the owner rejects a rebalance today, short bills are not swapped again", () => {
    const crit = payment({ amount: 500, currency: "USD", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [crit], usd: 300, rejectedSwapsToday: ["USD"] }));
    expect(res.actions.find((a) => a.type === "SWAP")).toBeUndefined();
    expect(res.actions[0]).toMatchObject({ type: "ESCALATE", paymentId: crit.id });
  });

  it("ignores payments already proposed, executing or paid", () => {
    const ps = ["PROPOSED", "EXECUTING", "PAID"].map((status) => payment({ amount: 100, status }));
    expect(decide(input({ payments: ps })).actions).toHaveLength(0);
  });

  it("keeps priority: a later small bill in a short currency waits behind payroll", () => {
    const big = payment({ amount: 1_100, currency: "USD", category: "PAYROLL" });
    const small = payment({ amount: 50, currency: "USD", category: "SAAS" });
    const res = decide(input({ payments: [small, big], usd: 1_200, ngn: 310_000 }));
    // USD can pay `small` alone, but payroll comes first and cannot be covered, so neither jumps ahead.
    expect(res.actions.find((a) => a.paymentId === small.id)!.type).not.toBe("PAY");
    expect(res.actions.find((a) => a.paymentId === big.id)!.type).toBe("ESCALATE");
  });
});

describe("decide: rebalancing across currencies", () => {
  it("covers a EUR bill from NGN surplus and refills the EUR buffer", () => {
    const p = payment({ amount: 900, currency: "EUR", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [p], eur: 0 }));
    const swap = res.actions[0];
    expect(swap).toMatchObject({ type: "SWAP", reasonCode: "REBALANCE", currency: "EUR" });
    // 900 + 1 fee + 200 buffer
    expect(swap.swap).toMatchObject({ from: "NGN", to: "EUR", toAmount: M(1_101) });
    expect(res.actions[1]).toMatchObject({ type: "PAY", paymentId: p.id, after: 0 });
  });

  it("picks the wallet with the most surplus above its buffer as the source", () => {
    const p = payment({ amount: 500, currency: "EUR", category: "CRITICAL_VENDOR" });
    const usdRich = input({ payments: [p], eur: 0, ngn: 400_000, usd: 5_000 });
    usdRich.policy = policy({ allowedPairs: ["NGN>EUR", "USD>EUR"] });
    expect(decide(usdRich).actions[0].swap?.from).toBe("USD");
  });

  it("never swaps into a currency the company has no wallet for", () => {
    const p = payment({ amount: 100, currency: "GBP", category: "CRITICAL_VENDOR" });
    const res = decide(input({ payments: [p] }));
    expect(res.actions.find((a) => a.type === "SWAP")).toBeUndefined();
    expect(res.actions[0].type).toBe("ESCALATE");
  });

  it("covers as many bills as the surplus allows, in priority order", () => {
    const a = payment({ amount: 800, currency: "USD", category: "PAYROLL" });
    const b = payment({ amount: 900, currency: "USD", category: "SAAS" });
    // NGN surplus above its buffer covers ~USD 1,000: enough for payroll, not both.
    const res = decide(input({ payments: [b, a], usd: 200, ngn: 1_800_000 }));
    expect(res.actions[0]).toMatchObject({ type: "SWAP", covers: [a.id] });
    expect(res.actions.find((x) => x.paymentId === a.id)!.type).toBe("PAY");
    expect(res.actions.find((x) => x.paymentId === b.id)).toMatchObject({ type: "DEFER", reasonCode: "SHORTFALL_NON_CRITICAL" });
  });
});
