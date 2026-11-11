// P2: an invalid amount never breaks a screen, is shown as "—" (never as $0.00) and is reported for
// diagnosis; values sent to the server keep the strict validation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INVALID_VALUE_TEXT,
  displayAmount,
  fmtBasisPoints,
  fmtMoneyCents,
  fmtNumber,
  fmtPercent,
  fmtRatePpm,
} from "@/lib/format";
import { averageCents, multiplyQuantityCents, saleTotals, sumCents } from "@/lib/money";
import { setLogWriter } from "@/lib/observability";
import { QUARANTINE_SUSPENDED_PREFIX, listSuspendedSales } from "@/lib/pos-service";

let lines: string[] = [];
let restore: ReturnType<typeof setLogWriter>;
beforeEach(() => {
  lines = [];
  restore = setLogWriter((line) => lines.push(line));
});
afterEach(() => {
  setLogWriter(restore);
  localStorage.clear();
});

describe("P2 — invalid amounts on screen", () => {
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined as unknown as number,
    "12" as unknown as number,
  ])("%s is shown as — and reported, never as $0.00", (value) => {
    const text = fmtMoneyCents(value, "en-US");
    expect(text).toBe(INVALID_VALUE_TEXT);
    expect(text).not.toBe("$0.00");
    expect(lines.some((l) => l.includes("money.invalid_display"))).toBe(true);
  });

  it("reports each invalid value once, not on every render", () => {
    for (let i = 0; i < 50; i++) fmtMoneyCents(Number.NEGATIVE_INFINITY, "en-US");
    expect(
      lines.filter((l) => l.includes("money.invalid_display") && l.includes("-Infinity")),
    ).toHaveLength(1);
  });

  it("valid amounts are unchanged (fractions of a cent rounded for display only)", () => {
    expect(fmtMoneyCents(123450, "en-US")).toBe("$1,234.50");
    expect(fmtMoneyCents(0, "en-US")).toBe("$0.00");
    expect(fmtMoneyCents(12.5, "en-US")).toBe("$0.13");
    expect(fmtMoneyCents(-250, "en-US")).toBe("-$2.50");
    expect(lines).toHaveLength(0);
  });

  it("a display computation that fails yields — instead of crashing the screen", () => {
    // e.g. a stock item whose quantity came back as NaN, or a non-integer cost
    const value = displayAmount(
      () => sumCents([multiplyQuantityCents(Number.NaN, 399), 100]),
      "money.stock_value",
    );
    expect(Number.isNaN(value)).toBe(true);
    expect(fmtMoneyCents(value, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(lines.some((l) => l.includes("money.stock_value"))).toBe(true);
    expect(displayAmount(() => averageCents(1001, 2), "money.x")).toBe(501);
  });

  it("rates, percentages and counts follow the same rule", () => {
    expect(fmtBasisPoints(Number.NaN, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(fmtPercent(Number.NaN, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(fmtNumber(Number.POSITIVE_INFINITY, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(fmtBasisPoints(888, "en-US")).toBe("8.88%");
    expect(fmtPercent(0.187, "en-US")).toBe("18.7%");
    // Store rates (0025): every decimal the server applies, none invented.
    expect(fmtRatePpm(88750, "en-US")).toBe("8.875%");
    expect(fmtRatePpm(62500, "en-US")).toBe("6.25%");
    expect(fmtRatePpm(0, "en-US")).toBe("0%");
    expect(fmtRatePpm(90250, "pt-BR")).toBe("9,025%");
    expect(fmtRatePpm(Number.NaN, "en-US")).toBe(INVALID_VALUE_TEXT);
  });

  it("values sent to the server stay strict (they still throw)", () => {
    expect(() => saleTotals([100, 0.5], 0, 888)).toThrow(RangeError);
    expect(() => saleTotals([100], Number.NaN, 888)).toThrow(RangeError);
    expect(() => multiplyQuantityCents(2, Number.NaN)).toThrow(RangeError);
  });

  it("a held POS ticket with a corrupted amount goes to quarantine instead of breaking the POS", () => {
    const base = {
      orgId: "org-p2",
      locationId: "loc-1",
      suspendedAt: new Date().toISOString(),
      orderType: "takeout",
      attendantName: "Ana",
      discountCents: 0,
      taxRatePpm: 88800,
    };
    const item = (subtotalCents: unknown) => ({
      id: "i1",
      productId: "p1",
      productName: "Burger",
      quantity: 1,
      basePriceCents: 1000,
      modifiers: [],
      subtotalCents,
    });
    localStorage.setItem(
      "servora.pos.suspended.org-p2",
      JSON.stringify([
        { ...base, id: "good", items: [item(1000)] },
        { ...base, id: "nan", items: [item(null)] },
        { ...base, id: "fraction", items: [item(999.5)] },
      ]),
    );
    expect(listSuspendedSales("org-p2").map((s) => s.id)).toEqual(["good"]);
    const quarantined = JSON.parse(
      localStorage.getItem(`${QUARANTINE_SUSPENDED_PREFIX}org-p2`) ?? "[]",
    );
    expect(quarantined.map((q: { entry: { id: string } }) => q.entry.id).sort()).toEqual([
      "fraction",
      "nan",
    ]);
  });
});
