import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  averageCents,
  basisPointsFromPercent,
  centsToDecimalString,
  divRound,
  formatMoney,
  lineTotalCents,
  multiplyQuantityCents,
  parseMoneyInput,
  roundCents,
  saleTotals,
  sumCents,
} from "@/lib/money";
import { convertQuantity, unitFamily } from "@/lib/units";
import { calculateOrderSummary } from "@/lib/orders-service";
import { convertUnits } from "@/lib/recipes-service";
import reference from "./fixtures/pg-money-reference.json";

// Values computed by PostgreSQL itself (see the fixture's $comment): the browser must give the
// server's answer to the cent.
describe("money: same rounding as the database", () => {
  it.each(reference.tax)("tax of %i cents at %i bp = %i (create_pos_sale)", (taxable, bp, tax) => {
    expect(applyBasisPoints(taxable, bp)).toBe(tax);
  });

  it.each(reference.quantityTimesCents)(
    "%s × %i cents = %i (purchase line / COGS)",
    (qty, cents, expected) => {
      expect(multiplyQuantityCents(Number(qty), Number(cents))).toBe(Number(expected));
    },
  );

  it("the previous float formula disagreed with the server; the shared one does not", () => {
    // Connecticut 6.35% on $410.00: Math.round(41000 * 6.35 / 100) gave 2603, the server books 2604.
    expect(Math.round((41000 * 6.35) / 100)).toBe(2603);
    expect(applyBasisPoints(41000, 635)).toBe(2604);
    expect(calculateOrderSummary([{ subtotalCents: 41000 } as never], 6.35).taxCents).toBe(2604);
    // A percentage with three decimals is sent as whole basis points (8.875% -> 888); the client
    // used 8.875 itself and disagreed with the server in most sales.
    expect(basisPointsFromPercent(8.875)).toBe(888);
    expect(calculateOrderSummary([{ subtotalCents: 107 } as never], 8.875).taxCents).toBe(
      applyBasisPoints(107, 888),
    );
  });

  it("negative amounts round away from zero like PostgreSQL (refunds, reversals)", () => {
    expect(applyBasisPoints(-50, 10000)).toBe(-50);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(5, 2)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
    expect(roundCents(2.5)).toBe(3);
    expect(Object.is(roundCents(-0.2), 0)).toBe(true);
  });

  it("is exact where floats are not", () => {
    expect(19.99 * 100).not.toBe(1999);
    expect(parseMoneyInput("19.99")).toBe(1999);
    expect(1.005 * 100).toBeLessThan(100.5);
    expect(multiplyQuantityCents(1.005, 100)).toBe(101); // exact 100.5 -> 101, as the database
    expect(applyBasisPoints(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(900719925474);
  });
});

describe("money: sale totals = create_pos_sale", () => {
  it("matches the recorded receipt of the PR #7 audit (3 × $2.75, $1.00 off, 8.88%)", () => {
    const line = lineTotalCents(275, [], 3);
    expect(saleTotals([line], 100, 888)).toEqual({
      subtotalCents: 825,
      discountCents: 100,
      taxableCents: 725,
      taxCents: 64,
      totalCents: 789,
    });
  });

  it("modifiers are added to the unit price before the quantity", () => {
    expect(lineTotalCents(1000, [150, 50], 2)).toBe(2400);
    expect(lineTotalCents(1000, [], 0)).toBe(1000); // quantity floor of 1, as before
  });

  it("taxable base never goes below zero", () => {
    expect(saleTotals([500], 900, 888)).toMatchObject({
      taxableCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("refuses fractions of a cent and unsafe numbers instead of silently drifting", () => {
    expect(() => sumCents([10, 0.5])).toThrow(RangeError);
    expect(() => applyBasisPoints(100, 8.875)).toThrow(RangeError);
    expect(() => lineTotalCents(100, [], 1.5)).toThrow(RangeError);
    expect(() => multiplyQuantityCents(2, 0.5)).toThrow(RangeError);
  });

  it("average ticket", () => {
    expect(averageCents(1001, 2)).toBe(501);
    expect(averageCents(0, 0)).toBe(0);
    expect(averageCents(328710, 266)).toBe(1236); // Reports value validated in the PR #7 audit
  });
});

describe("money: typed amounts (no parseFloat)", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12,5", 1250],
    ["0.29", 29],
    [".5", 50],
    ["12.", 1200],
    ["1,234.50", 123450], // en-US
    ["1.234,50", 123450], // pt-BR
    ["1,234", 123400], // three digits after a single separator = thousands
    ["1.234.567,89", 123456789],
    ["$ 9.99", 999],
    ["US$12.00", 1200],
    ["R$ 10,00", 1000],
    ["  7  ", 700],
    ["0", 0],
  ])("%s -> %i cents", (text, cents) => {
    expect(parseMoneyInput(text)).toBe(cents);
  });

  it.each(["", "abc", "12a", "1.2345", "1,2,3", "1,23,456", "1.234.56", "--1", "1.000.000.0"])(
    "%s is rejected",
    (text) => {
      expect(parseMoneyInput(text)).toBeNull();
    },
  );

  it("negatives only when allowed", () => {
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("-5", { allowNegative: true })).toBe(-500);
    expect(parseMoneyInput("-$5.10", { allowNegative: true })).toBe(-510);
  });

  it("the previous POS parser read 1,234.50 as $1.23", () => {
    const old = (value: string) => {
      const n = parseFloat(value.replace(",", "."));
      return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) : 0;
    };
    expect(old("1,234.50")).toBe(123);
    expect(parseMoneyInput("1,234.50")).toBe(123450);
  });

  it("decimal strings for inputs and CSV round-trip exactly", () => {
    for (const c of [0, 5, 99, 100, 1999, 123456789, -1205, -5]) {
      expect(parseMoneyInput(centsToDecimalString(c), { allowNegative: true })).toBe(c);
    }
    expect(centsToDecimalString(-1205)).toBe("-12.05");
    expect(centsToDecimalString(5)).toBe("0.05");
  });

  it("reads back the formatted amounts of both languages (no-break spaces included)", () => {
    expect(parseMoneyInput(formatMoney(123450, "pt-BR"))).toBe(123450);
    expect(parseMoneyInput(formatMoney(123450, "en-US"))).toBe(123450);
    expect(parseMoneyInput("R$" + String.fromCharCode(160) + "10,00")).toBe(1000);
  });

  it("formats in the viewer's language", () => {
    expect(formatMoney(123450, "en-US")).toBe("$1,234.50");
    expect(formatMoney(123450, "pt-BR").replace(/\s/g, " ")).toBe("US$ 1.234,50");
  });
});

describe("units: same factors as public.operational_unit_quantity", () => {
  it.each(reference.unitOf1_5)("1.5 %s in %s = %s", (from, to, expected) => {
    const got = convertQuantity(1.5, from, to);
    expect(got).not.toBeNull();
    expect(Math.abs((got as number) - Number(expected))).toBeLessThanOrEqual(
      Math.abs(Number(expected)) * 1e-12,
    );
  });

  it("different families do not convert (the server refuses them too)", () => {
    expect(convertQuantity(1, "oz", "gal")).toBeNull(); // oz is mass on the server
    expect(convertQuantity(1, "units", "lb")).toBeNull();
    expect(convertQuantity(1, "units", "pack")).toBeNull();
    expect(unitFamily("tbsp")).toBe("volume");
    expect(unitFamily("pack")).toBe("count");
  });

  it("recipe costing now uses the server's factors (500 g used to read as 500 kg)", () => {
    expect(convertUnits(500, "g", "kg")).toBeCloseTo(0.5, 12);
    expect(convertUnits(1, "g", "lb")).toBeCloseTo(1 / 453.59237, 15);
    expect(convertUnits(16, "oz", "lb")).toBe(1);
  });
});
