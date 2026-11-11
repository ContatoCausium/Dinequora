import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  applyPartsPerMillion,
  basisPointsFromPpm,
  centsFromDollars,
  centsFromNumberInput,
  averageCents,
  basisPointsFromPercent,
  centsToDecimalString,
  isRatePpm,
  percentTextFromPpm,
  ppmFromPercentInput,
  RATE_PPM_MAX,
  divRound,
  formatMoney,
  lineTotalCents,
  multiplyQuantityCents,
  parseMoneyInput,
  roundCents,
  saleTotals,
  sumCents,
  MONEY_INPUT_MAX_EXPONENT,
  MONEY_INPUT_MAX_LENGTH,
  MONEY_INPUT_MAX_SCALE,
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
    expect(calculateOrderSummary([{ subtotalCents: 41000 } as never], 63500).taxCents).toBe(2604);
    // A rate with three decimals is exact in parts per million (8.875% = 88,750 ppm): 107 × 8.875%
    // = 9.49625 → 9. Whole basis points (888, the unit before 0025) would have charged 10.
    expect(basisPointsFromPercent(8.875)).toBe(888);
    expect(applyBasisPoints(107, 888)).toBe(10);
    expect(calculateOrderSummary([{ subtotalCents: 107 } as never], 88750).taxCents).toBe(9);
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

describe("money: sale totals = create_pos_sale_v2", () => {
  it("matches the recorded receipt of the PR #7 audit (3 × $2.75, $1.00 off, 8.88%)", () => {
    const line = lineTotalCents(275, [], 3);
    expect(saleTotals([line], 100, 88800)).toEqual({
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
    expect(saleTotals([500], 900, 88800)).toMatchObject({
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

describe("money: number fields (P1 — <input type=number> values)", () => {
  // The browser gives a plain number with "." as the decimal separator, in every language.
  it.each([
    ["0.125", 13], // a purchase unit cost: 12.5 cents rounds half away from zero, like the server
    ["9.995", 1000], // menu price: never $9,995
    ["12.345", 1235],
    ["1.005", 101], // exact: Math.round(1.005 * 100) gave 100
    ["19.99", 1999],
    ["0.5", 50],
    [".5", 50],
    ["12", 1200],
    ["0", 0],
    ["1e2", 10000],
  ])("%s -> %i cents", (value, cents) => {
    expect(centsFromNumberInput(value)).toBe(cents);
  });

  it.each(["", " ", "abc", "1,234.50", "1.234,50", "12.3.4", "--1", "1e"])(
    "%j is refused (null), never turned into 0",
    (value) => {
      expect(centsFromNumberInput(value)).toBeNull();
    },
  );

  it("negatives only when allowed", () => {
    expect(centsFromNumberInput("-5")).toBeNull();
    expect(centsFromNumberInput("-5.255", { allowNegative: true })).toBe(-526);
  });

  it("the audited defect: the free-text reading gave 1000x the amount", () => {
    expect(parseMoneyInput("0.125", { format: "number-input" })).toBe(13);
    expect(centsFromNumberInput("9.995")).not.toBe(999500);
  });

  it("the expense amount (the only money field inside a <form>) lets 12.345 be submitted", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/finance/expense-form-dialog.tsx"),
      "utf8",
    );
    const field = src.slice(src.indexOf("id={`${id}-amount`}"), src.indexOf("value={v.amount}"));
    expect(field).toContain('type="number"');
    expect(field).toContain('step="any"'); // step="0.01" makes the browser refuse 12.345
  });

  it("receiving form (number state) converts exactly too", () => {
    expect(centsFromDollars(0.125)).toBe(13);
    expect(centsFromDollars(9.995)).toBe(1000);
    expect(centsFromDollars(12.345)).toBe(1235);
    expect(centsFromDollars(4.35)).toBe(435);
  });
});

// Audit follow-up: the exponent and the length of a typed amount are bounded BEFORE any BigInt
// arithmetic, so no input can stall the interface or throw out of a change handler.
describe("money: number fields cannot stall the interface (exponent and length limits)", () => {
  it.each([
    ["1e2", 10000],
    ["1e+2", 10000],
    ["1e-2", 1],
    ["1.5e-1", 15],
    ["12.5e1", 12500],
    ["2.5e-3", 0], // a quarter of a cent rounds to 0, exactly like "0.0025"
    ["-0", 0],
    ["12.34", 1234],
    ["0.125", 13],
    ["0".repeat(MONEY_INPUT_MAX_LENGTH - 5) + "12.34", 1234], // exactly at the length limit
  ])("%s -> %i cents", (value, cents) => {
    expect(centsFromNumberInput(value)).toBe(cents);
  });

  it.each([
    "1e+200000000", // took ~19 s of CPU before the limit
    "1e-200000000",
    "1e+41",
    "1e-41",
    "1e999",
    "1e+1000",
    "1e40", // beyond the largest amount
    "1" + "0".repeat(MONEY_INPUT_MAX_LENGTH), // one character over the limit
    "0." + "0".repeat(MONEY_INPUT_MAX_SCALE + 1),
    "",
    "   ",
    "abc",
    "1e",
    "e5",
    "1e5.5",
  ])("%j is refused (null): never 0, never an exception", (value) => {
    expect(centsFromNumberInput(value)).toBeNull();
    expect(centsFromNumberInput(value, { allowNegative: true })).toBeNull();
  });

  it("extreme exponents and huge digit strings are refused in milliseconds, in both formats", () => {
    const inputs = [
      "1e+200000000",
      "1e-200000000",
      "-1e+200000000",
      "9".repeat(10_000),
      "1." + "9".repeat(10_000),
      "9".repeat(10_000) + "e+999",
    ];
    const t0 = performance.now();
    for (const v of inputs) {
      expect(centsFromNumberInput(v)).toBeNull();
      expect(parseMoneyInput(v)).toBeNull();
    }
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("the limits are the documented constants", () => {
    expect([MONEY_INPUT_MAX_LENGTH, MONEY_INPUT_MAX_EXPONENT, MONEY_INPUT_MAX_SCALE]).toEqual([
      60, 40, 40,
    ]);
    expect(centsFromNumberInput(`1e${MONEY_INPUT_MAX_EXPONENT}`)).toBeNull(); // out of range, not a stall
    expect(centsFromNumberInput(`1e-${MONEY_INPUT_MAX_SCALE}`)).toBe(0); // 10^-40 dollars: 0 cents
    expect(centsFromNumberInput(`1e-${MONEY_INPUT_MAX_SCALE + 1}`)).toBeNull();
    expect(centsFromNumberInput("0".repeat(MONEY_INPUT_MAX_LENGTH - 4) + "12.34")).toBeNull(); // 61 chars
    expect(parseMoneyInput("0".repeat(MONEY_INPUT_MAX_LENGTH - 4) + "12.34")).toBeNull();
  });
});

describe("money: free text never reads a leading-zero group as thousands", () => {
  it.each([
    ["0.125", 13],
    ["0,125", 13],
    ["0.1234", 12],
    ["0,5", 50],
    ["01,234", 123],
  ])("%s -> %i cents", (text, cents) => {
    expect(parseMoneyInput(text)).toBe(cents);
  });

  it("real thousands groups are unchanged", () => {
    expect(parseMoneyInput("1,234")).toBe(123400);
    expect(parseMoneyInput("1.234,50")).toBe(123450);
    expect(parseMoneyInput("12.345.678,90")).toBe(1234567890);
    expect(parseMoneyInput("1.2345")).toBeNull();
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

// Migration 0025: store rates in parts per million, charged by the server from the store's own rate.
describe("money: store rates in parts per million (0025)", () => {
  it.each(reference.taxPpm)(
    "tax of %i cents at %i ppm = %i (create_pos_sale_v2)",
    (taxable, ppm, tax) => {
      expect(applyPartsPerMillion(taxable, ppm)).toBe(tax);
    },
  );

  it("represents the US rates whole basis points cannot (6.625%, 8.875%, 9.025%)", () => {
    expect(ppmFromPercentInput("6.625")).toBe(66250);
    expect(ppmFromPercentInput("8.875")).toBe(88750);
    expect(ppmFromPercentInput("9.025")).toBe(90250);
    expect(applyPartsPerMillion(1000, 88750)).toBe(89); // 88.75 -> 89
    expect(applyPartsPerMillion(1000, 62500)).toBe(63); // 62.5 -> 63, half away from zero
    expect(applyPartsPerMillion(1500, 88750)).toBe(133); // 133.125 -> 133
    expect(applyPartsPerMillion(107, 88750)).toBe(9); // 9.49625 -> 9 (888 bp charged 10)
    expect(saleTotals([1000, 1000], 500, 88750)).toEqual({
      subtotalCents: 2000,
      discountCents: 500,
      taxableCents: 1500,
      taxCents: 133,
      totalCents: 1633,
    });
    expect(basisPointsFromPpm(88750)).toBe(888); // what older readers see
    expect(basisPointsFromPpm(62500)).toBe(625);
    expect(basisPointsFromPpm(0)).toBe(0);
  });

  it("a typed percentage becomes ppm exactly, or is refused", () => {
    expect(ppmFromPercentInput("0")).toBe(0);
    expect(ppmFromPercentInput("100")).toBe(RATE_PPM_MAX);
    expect(ppmFromPercentInput(" 7 ")).toBe(70000);
    expect(ppmFromPercentInput("8.8750")).toBe(88750);
    expect(ppmFromPercentInput(".5")).toBe(5000);
    expect(ppmFromPercentInput("6.25")).toBe(62500);
    // finer than 1 ppm, out of range, negative, empty, not a plain decimal
    expect(ppmFromPercentInput("8.87555")).toBeNull();
    expect(ppmFromPercentInput("100.0001")).toBeNull();
    expect(ppmFromPercentInput("-1")).toBeNull();
    expect(ppmFromPercentInput("")).toBeNull();
    expect(ppmFromPercentInput("abc")).toBeNull();
    expect(ppmFromPercentInput("1e2")).toBeNull();
    expect(ppmFromPercentInput("8,875")).toBeNull();
    expect(ppmFromPercentInput("1".repeat(200))).toBeNull();
  });

  it("ppm is shown back as the exact percentage text", () => {
    expect(percentTextFromPpm(88750)).toBe("8.875");
    expect(percentTextFromPpm(62500)).toBe("6.25");
    expect(percentTextFromPpm(0)).toBe("0");
    expect(percentTextFromPpm(RATE_PPM_MAX)).toBe("100");
    expect(percentTextFromPpm(90250)).toBe("9.025");
    expect(percentTextFromPpm(1)).toBe("0.0001");
    for (const text of ["8.875", "6.25", "0", "100", "9.025", "0.0001", "12.3456"])
      expect(percentTextFromPpm(ppmFromPercentInput(text)!)).toBe(text);
  });

  it("refuses rates that are not whole ppm between 0 and 100%", () => {
    expect(isRatePpm(88750)).toBe(true);
    expect(isRatePpm(0)).toBe(true);
    expect(isRatePpm(RATE_PPM_MAX)).toBe(true);
    expect(isRatePpm(-1)).toBe(false);
    expect(isRatePpm(RATE_PPM_MAX + 1)).toBe(false);
    expect(isRatePpm(8.875)).toBe(false);
    expect(isRatePpm(Number.NaN)).toBe(false);
    expect(isRatePpm(null)).toBe(false);
    expect(() => applyPartsPerMillion(100, 8.875)).toThrow(RangeError);
    expect(() => applyPartsPerMillion(100, -1)).toThrow(RangeError);
    expect(() => applyPartsPerMillion(100, RATE_PPM_MAX + 1)).toThrow(RangeError);
    expect(() => applyPartsPerMillion(100.5, 88750)).toThrow(RangeError);
    expect(() => saleTotals([100], 0, Number.NaN)).toThrow(RangeError);
    expect(() => basisPointsFromPpm(-5)).toThrow(RangeError);
    expect(() => percentTextFromPpm(RATE_PPM_MAX + 1)).toThrow(RangeError);
  });

  it("stays exact at the top of the safe range", () => {
    expect(applyPartsPerMillion(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(9007199255);
    expect(applyPartsPerMillion(2147483647, RATE_PPM_MAX)).toBe(2147483647);
    expect(applyPartsPerMillion(-2147483647, 88750)).toBe(-190589174); // -190589173.67 -> away from zero
  });
});
