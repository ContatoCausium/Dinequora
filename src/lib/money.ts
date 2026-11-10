/**
 * Money for every module (POS, Orders, Finance, Reports, Dashboard, Menu, Purchases, Inventory).
 *
 * - Amounts are integer CENTS (a safe integer `number`). Never floating dollars.
 * - Sales-tax rates are integer BASIS POINTS (888 = 8.88%): the unit the database stores and applies.
 * - Rounding is HALF AWAY FROM ZERO, the rule of PostgreSQL round(numeric) used by every RPC
 *   (create_pos_sale tax, finalize COGS, purchase order lines), so browser and server agree to the
 *   cent. Integer arithmetic only (BigInt where a product could exceed 2^53).
 * - Typed amounts are parsed from the TEXT, never with parseFloat: "1,234.50", "1.234,50", "$12".
 * - Floats appear only for display ratios (margins, shares) and for measured quantities (2.5 lb),
 *   and a quantity × price is rounded once, exactly, by multiplyQuantityCents.
 */
export type Cents = number;

const TEN_THOUSAND = 10000n;

export function isCents(v: unknown): v is Cents {
  return typeof v === "number" && Number.isSafeInteger(v);
}

export function assertCents(v: number, label = "amount"): Cents {
  if (!isCents(v)) throw new RangeError(`${label} must be an integer number of cents (got ${v})`);
  return v;
}

function toSafeNumber(v: bigint, label: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER))
    throw new RangeError(`${label} is out of range`);
  return Number(v);
}

/** numerator / denominator rounded half away from zero (PostgreSQL round(numeric)). */
function divRoundBig(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/** Integer division of two safe integers, rounded half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    throw new RangeError("divRound expects integers");
  return Number(divRoundBig(BigInt(numerator), BigInt(denominator)));
}

/** Rounds a measured (non-integer) value to whole cents, half away from zero. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError("amount must be finite");
  return assertCents(Math.sign(value) * Math.round(Math.abs(value)) || 0);
}

export function sumCents(values: Iterable<number>): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, "sum");
}

/** cents × basisPoints / 10,000, rounded like the server (create_pos_sale tax). */
export function applyBasisPoints(cents: Cents, basisPoints: number): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError("basis points must be an integer");
  return toSafeNumber(divRoundBig(BigInt(cents) * BigInt(basisPoints), TEN_THOUSAND), "tax");
}

/** Exact decimal value of a plain decimal text ("12.5", "-0.125", "1e-7"): digits × 10^-scale. */
function decimalOfText(text: string): { digits: bigint; scale: number } {
  const [mantissa = "0", exp = "0"] = text.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [int = "", frac = ""] = mantissa.replace(/^[-+]/, "").split(".");
  let digits = BigInt(int + frac || "0");
  let scale = frac.length - Number(exp);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits: negative ? -digits : digits, scale };
}

/** Exact decimal value of a finite number: digits × 10^-scale (from its shortest representation). */
function decimalOf(x: number): { digits: bigint; scale: number } {
  if (!Number.isFinite(x)) throw new RangeError("value must be finite");
  return decimalOfText(String(x));
}

/** A decimal amount of dollars → cents, rounded half away from zero (0.125 → 13, 9.995 → 1000). */
function centsOfDecimal(d: { digits: bigint; scale: number }): bigint {
  return divRoundBig(d.digits * 100n, 10n ** BigInt(d.scale));
}

/**
 * quantity × unit price, rounded once to whole cents. Matches the server's
 * round(quantity * cost_cents) for the stored quantity (purchase lines, stock valuation, COGS).
 */
export function multiplyQuantityCents(quantity: number, unitCents: Cents): Cents {
  assertCents(unitCents, "unit price");
  const q = decimalOf(quantity);
  return toSafeNumber(
    divRoundBig(q.digits * BigInt(unitCents), 10n ** BigInt(q.scale)),
    "line amount",
  );
}

/** (unit price + modifiers) × quantity: one POS line, same formula as create_pos_sale. */
export function lineTotalCents(
  unitCents: Cents,
  modifierCents: readonly Cents[],
  quantity: number,
): Cents {
  const qty = Math.max(1, quantity);
  if (!Number.isSafeInteger(qty)) throw new RangeError("quantity must be a whole number");
  return assertCents((assertCents(unitCents) + sumCents(modifierCents)) * qty, "line amount");
}

export interface SaleTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  taxableCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

/**
 * Totals of one sale exactly as create_pos_sale computes them: tax = round((subtotal − discount) ×
 * rate / 10,000), total = subtotal − discount + tax. A discount above the subtotal is refused by the
 * server ("invalid_discount"); here the taxable base never goes below zero.
 */
export function saleTotals(
  lineSubtotalsCents: readonly Cents[],
  discountCents: Cents,
  taxRateBasisPoints: number,
): SaleTotals {
  const subtotalCents = sumCents(lineSubtotalsCents);
  const discount = assertCents(discountCents, "discount");
  const taxableCents = Math.max(0, subtotalCents - discount);
  const taxCents = applyBasisPoints(taxableCents, taxRateBasisPoints);
  return {
    subtotalCents,
    discountCents: discount,
    taxableCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

/** Average of a cents total over a count (average ticket), rounded half away from zero. */
export function averageCents(totalCents: Cents, count: number): Cents {
  return count > 0 ? divRound(assertCents(totalCents), count) : 0;
}

/** part / whole for display (margins, shares); 0 when the whole is 0. Never use it for money. */
export function ratio(part: number, whole: number): number {
  return whole !== 0 ? part / whole : 0;
}

/**
 * Percentage (8.88) → basis points (888), rounded half away from zero to the nearest basis point,
 * from the exact decimal value. This is the rate the server receives and applies.
 */
export function basisPointsFromPercent(percent: number): number {
  const p = decimalOf(percent);
  return toSafeNumber(divRoundBig(p.digits * 100n, 10n ** BigInt(p.scale)), "rate");
}

/**
 * A dollar amount held as a number (value of an <input type="number">, e.g. 4.35) → cents, from its
 * exact decimal value (4.35 * 100 is 434.99999999999994 in floating point).
 */
export function centsFromDollars(dollars: number): Cents {
  return toSafeNumber(centsOfDecimal(decimalOf(dollars)), "amount");
}

/** "-12.05" for an amount of -1205 cents: inputs and CSV exports, no float involved. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const whole = (abs - (abs % 100)) / 100;
  return `${cents < 0 ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const CURRENCY_AFFIX = /^(?:US\$|R\$|\$|USD|BRL)\s*|\s*(?:US\$|R\$|\$|USD|BRL)$/gi;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export interface ParseMoneyOptions {
  allowNegative?: boolean;
  /**
   * "number-input": the value of an <input type="number">. Browsers always give a plain number
   * with "." as the decimal separator and no grouping, whatever the language ("9.995" is nine
   * dollars and 99.5 cents, never 9,995). "text" (default): free text in either language.
   */
  format?: "text" | "number-input";
}

/**
 * Parses a typed amount into cents without floating point. More than two decimals are rounded
 * half away from zero, like the server (0.125 → 13 cents, 9.995 → $10.00).
 *
 * Free text accepts either decimal separator and thousands separators ("1,234.50", "1.234,50",
 * "1234.5", "12", "$ 9.99"). A single separator followed by exactly three digits is a thousands
 * separator ("1,234" = 1234.00) unless the first group starts with 0 ("0.125", "0,125" are
 * decimals: no amount is written with a leading zero group). Returns null for anything ambiguous
 * or invalid (letters, misplaced groups, a sign when negatives are not allowed) — never 0.
 */
export function parseMoneyInput(text: string, opts: ParseMoneyOptions = {}): Cents | null {
  if (opts.format === "number-input") return parseNumberInput(text, opts);
  // trim() and \s (currency affixes) already cover the no-break space of formatted amounts.
  let s = text.trim();
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(CURRENCY_AFFIX, "").trim();
  if (s.startsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(1).trim();
  }
  if (negative && !opts.allowNegative) return null;
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let fracPart = "";
  let thousands: string | null = null;
  let roundExtraDecimals = false;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    thousands = dec === "." ? "," : ".";
    const at = s.lastIndexOf(dec);
    if (s.indexOf(dec) !== at) return null;
    intPart = s.slice(0, at);
    fracPart = s.slice(at + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const at = s.lastIndexOf(sep);
    const count = s.split(sep).length - 1;
    const after = s.length - at - 1;
    const leadingZeroGroup = /^0/.test(s);
    if (count === 1 && (after <= 2 || leadingZeroGroup)) {
      intPart = s.slice(0, at);
      fracPart = s.slice(at + 1);
      roundExtraDecimals = leadingZeroGroup;
    } else if (after === 3) {
      thousands = sep;
    } else {
      return null;
    }
  }
  if (thousands) {
    const groups = intPart.split(thousands);
    // A first group starting with 0 is never a thousands group ("0.125", "01,234").
    if (/^0/.test(groups[0] ?? "") && groups.length > 1) return null;
    if (groups.some((g, i) => (i === 0 ? !/^\d{1,3}$/.test(g) : !/^\d{3}$/.test(g)))) return null;
    intPart = groups.join("");
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || intPart + fracPart === "") return null;
  if (fracPart.length > 2 && !roundExtraDecimals) return null;
  const cents = centsOfDecimal({
    digits: BigInt(intPart + fracPart || "0"),
    scale: fracPart.length,
  });
  if (cents > MAX_CENTS) return null;
  return Number(negative ? -cents : cents) || 0;
}

/** The value of an <input type="number"> → cents (see ParseMoneyOptions.format). */
function parseNumberInput(text: string, opts: ParseMoneyOptions): Cents | null {
  const s = text.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const d = decimalOfText(s);
  if (d.digits < 0n && !opts.allowNegative) return null;
  if (d.scale > 40) return null; // absurd precision (e.g. "1e-99"): not an amount
  const cents = centsOfDecimal(d);
  if (cents > MAX_CENTS || cents < -MAX_CENTS) return null;
  return Number(cents) || 0;
}

/** Value of an <input type="number"> holding dollars → cents; null when empty or invalid. */
export function centsFromNumberInput(
  value: string,
  opts: { allowNegative?: boolean } = {},
): Cents | null {
  return parseMoneyInput(value, { ...opts, format: "number-input" });
}

/** Locale currency text for an amount in cents. */
export function formatMoney(
  cents: Cents,
  lng: string,
  opts: { compact?: boolean; currency?: string } = {},
): string {
  return new Intl.NumberFormat(lng, {
    style: "currency",
    currency: opts.currency ?? "USD",
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.compact ? 0 : 2,
    maximumFractionDigits: opts.compact ? 1 : 2,
  }).format(assertCents(cents) / 100);
}
