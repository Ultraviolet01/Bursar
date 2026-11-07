import { describe, expect, it } from "vitest";
import { evaluate, type PolicyContext } from "../src/engine/policy";
import type { ProposedAction } from "../src/engine/types";
import { M, market, policy } from "./fixtures";

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  policy: policy(),
  paused: false,
  wallets: [
    { currency: "NGN", blaaizWalletId: "n", balance: M(8_000_000) },
    { currency: "USD", blaaizWalletId: "u", balance: M(1_200) },
  ],
  market: market(),
  todaySpentNgn: 0,
  payee: { id: "x", name: "Ada Obi", category: "PAYROLL", currency: "NGN", allowlisted: true, critical: true },
  ...over,
});

const pay = (amount: number, currency: "NGN" | "USD" = "NGN"): ProposedAction => ({
  type: "PAY", amount: M(amount), currency, fee: M(50), reasonCode: "ROUTINE_OK", reasons: ["ROUTINE_OK"], notes: [],
});

const status = (r: ReturnType<typeof evaluate>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("policy", () => {
  it("passes a routine payment", () => {
    const r = evaluate(pay(450_000), ctx());
    expect(r.autoOk).toBe(true);
  });

  it("PAUSED is a hard fail, even with owner approval", () => {
    const r = evaluate(pay(450_000), ctx({ paused: true, ownerApproved: true }));
    expect(status(r, "paused")).toBe("fail");
    expect(r.ownerOk).toBe(false);
  });

  it("new payee needs the owner, and approval clears it", () => {
    const payee = { ...ctx().payee!, allowlisted: false };
    expect(status(evaluate(pay(1_000), ctx({ payee })), "allowlist")).toBe("needs_owner");
    const approved = evaluate(pay(1_000), ctx({ payee, ownerApproved: true }));
    expect(status(approved, "allowlist")).toBe("approved");
    expect(approved.ownerOk).toBe(true);
  });

  it("caps need the owner", () => {
    expect(status(evaluate(pay(2_500_000), ctx()), "payment_cap")).toBe("needs_owner");
    expect(status(evaluate(pay(100_000), ctx({ todaySpentNgn: M(4_950_000) })), "daily_cap")).toBe("needs_owner");
  });

  it("an automated action can never breach the buffer", () => {
    const r = evaluate(pay(7_800_000), ctx({ policy: policy({ perPaymentCap: { NGN: M(9_000_000), USD: M(1_500), EUR: M(1_400), GBP: M(1_200) }, dailyCapNgn: M(9_000_000) }) }));
    expect(status(r, "buffer")).toBe("needs_owner");
    expect(r.autoOk).toBe(false);
  });

  it("insufficient funds is a hard fail", () => {
    const r = evaluate(pay(9_000_000), ctx({ ownerApproved: true }));
    expect(status(r, "funds")).toBe("fail");
    expect(r.ownerOk).toBe(false);
  });

  it("swap checks: pair, rate band, swap cap", () => {
    const swap: ProposedAction = {
      type: "SWAP", amount: M(500), currency: "USD", fee: 0, reasonCode: "BELOW_BUFFER_FORECAST", reasons: [], notes: [],
      swap: { from: "NGN", to: "USD", amountType: "to", toAmount: M(500), fromAmount: M(753_750), rate: 1500 },
    };
    // Bursar never swaps on its own: every swap needs the founder, and approval clears it.
    expect(evaluate(swap, ctx()).autoOk).toBe(false);
    expect(status(evaluate(swap, ctx()), "founder_swap")).toBe("needs_owner");
    expect(evaluate(swap, ctx()).ownerOk).toBe(true);
    expect(status(evaluate(swap, ctx({ ownerApproved: true })), "founder_swap")).toBe("approved");
    expect(status(evaluate(swap, ctx({ policy: policy({ allowedPairs: [] }) })), "pair")).toBe("fail");
    expect(status(evaluate(swap, ctx({ market: market({ USD: 1600 }, { USD: 1500 }) })), "rate")).toBe("needs_owner");
    expect(status(evaluate(swap, ctx({ policy: policy({ perSwapCapNgn: M(500_000) }) })), "swap_cap")).toBe("needs_owner");
  });

  it("auto-execute off sends everything to the owner", () => {
    const r = evaluate(pay(1_000), ctx({ policy: policy({ autoExecute: false }) }));
    expect(r.autoOk).toBe(false);
    expect(r.ownerOk).toBe(true);
  });
});
