import { describe, expect, it } from "vitest";
import { forecast } from "../src/engine/forecast";
import { convert, formatMoney, swapCostFor, toMinor } from "../src/lib/money";
import { signWebhook, verifyWebhookSignature } from "../src/blaaiz/signature";
import { M, RATES, TODAY, policy } from "./fixtures";
import { addDays } from "../src/lib/dates";

describe("money", () => {
  it("parses and formats minor units without floats", () => {
    expect(toMinor("450,000")).toBe(45_000_000);
    expect(toMinor("0.1")).toBe(10);
    expect(formatMoney(45_000_000, "NGN")).toBe("NGN 450,000.00");
    expect(convert(M(100), "USD", "NGN", RATES)).toBe(M(150_000));
    expect(convert(M(1_620), "NGN", "EUR", RATES)).toBe(M(1));
    expect(convert(M(100), "GBP", "USD", RATES)).toBe(M(126));
  });
  it("swap cost rounds up and includes the fee", () => {
    expect(swapCostFor(M(100), "NGN", "USD", RATES, 50)).toBe(M(150_750));
    expect(swapCostFor(M(100), "USD", "EUR", RATES, 0)).toBe(M(108));
  });
});

describe("forecast", () => {
  it("projects balances and finds the first day below buffer", () => {
    const f = forecast({
      today: TODAY,
      horizonDays: 14,
      wallets: [{ currency: "USD", blaaizWalletId: "u", balance: M(1_000) }],
      policy: policy(),
      outflows: [
        { currency: "USD", amount: M(500), dueDate: addDays(TODAY, 2) },
        { currency: "USD", amount: M(400), dueDate: addDays(TODAY, 6) },
        { currency: "USD", amount: M(999), dueDate: addDays(TODAY, 20) },
      ],
    });
    expect(f.USD!.projected).toBe(M(100));
    expect(f.USD!.belowBufferOn).toBe(addDays(TODAY, 6));
    expect(f.USD!.series).toHaveLength(14);
    expect(f.USD!.series[3].balance).toBe(M(500));
  });
});

describe("webhook signatures", () => {
  it("accepts a valid signature and rejects tampering", () => {
    const body = '{"event":"payout.completed"}';
    const sig = signWebhook(body, "1700000000", "s");
    expect(verifyWebhookSignature(body, sig, "1700000000", "s")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "1700000000", "s")).toBe(false);
    expect(verifyWebhookSignature(body, sig, "1700000001", "s")).toBe(false);
  });
});
