import { formatMoney, roundCents } from "./money";
import { captureError } from "./observability";

export function fmtCurrency(v: number, lng: string, compact = false) {
  return new Intl.NumberFormat(lng, {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : v >= 1000 ? 0 : 2,
  }).format(v);
}

/** What screens show for an amount that cannot be presented (never a made-up 0). */
export const INVALID_VALUE_TEXT = "—";

const reportedInvalid = new Set<string>();
/** Reports an invalid displayed value once per kind/value, so diagnosis never floods the logs. */
function reportInvalid(event: string, value: unknown, detail?: unknown) {
  const key = `${event}:${String(value)}`;
  if (reportedInvalid.has(key)) return;
  reportedInvalid.add(key);
  captureError(detail instanceof Error ? detail : new Error("invalid value on screen"), {
    event,
    value: String(value),
  });
}

/**
 * Money stored as integer cents (every ledger, order, price and cost column).
 * Always pass cents here — never divide by 100 at call sites — so a value can't be shown 100x.
 * Single implementation: money.ts formatMoney. A value that is not a finite number (NaN,
 * Infinity, undefined from corrupted data) is shown as "—" and reported; it never breaks the screen
 * and is never shown as $0.00. Fractions of a cent are rounded half away from zero for display.
 */
export function fmtMoneyCents(cents: number, lng: string, opts: { compact?: boolean } = {}) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) {
    reportInvalid("money.invalid_display", cents);
    return INVALID_VALUE_TEXT;
  }
  try {
    return formatMoney(roundCents(cents), lng, opts);
  } catch (err) {
    reportInvalid("money.invalid_display", cents, err); // beyond the safe integer range
    return INVALID_VALUE_TEXT;
  }
}

/**
 * Runs a money computation for DISPLAY. If it throws (non-integer cents, NaN quantities from
 * corrupted data), the error is reported and NaN is returned, which fmtMoneyCents shows as "—".
 * Values sent to the server keep the strict, throwing helpers.
 */
export function displayAmount(compute: () => number, event: string): number {
  try {
    return compute();
  } catch (err) {
    reportInvalid(event, "computation", err);
    return Number.NaN;
  }
}

/** Stock and recipe quantities: at most `digits` decimals, trailing zeros dropped (2.9016 -> "2.9"). */
export function fmtQuantity(v: number, lng: string, digits = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    reportInvalid("number.invalid_display", v);
    return INVALID_VALUE_TEXT;
  }
  return new Intl.NumberFormat(lng, { maximumFractionDigits: digits }).format(v);
}

/** Basis points (888 = 8.88%) shown with the precision the backend actually applies. */
export function fmtBasisPoints(bp: number, lng: string) {
  if (typeof bp !== "number" || !Number.isFinite(bp)) {
    reportInvalid("rate.invalid_display", bp);
    return INVALID_VALUE_TEXT;
  }
  return new Intl.NumberFormat(lng, { style: "percent", maximumFractionDigits: 2 }).format(
    bp / 10000,
  );
}

export function fmtNumber(v: number, lng: string, compact = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    reportInvalid("number.invalid_display", v);
    return INVALID_VALUE_TEXT;
  }
  return new Intl.NumberFormat(lng, {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(v);
}

export function fmtPercent(v: number, lng: string, signed = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    reportInvalid("number.invalid_display", v);
    return INVALID_VALUE_TEXT;
  }
  return new Intl.NumberFormat(lng, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(v);
}

/**
 * Timestamps (orders, movements, audit) in a real time zone — the store's when known, otherwise the
 * viewer's. Use this for anything with a time of day; `fmtDate` is for plain calendar dates (UTC-safe).
 */
export function fmtDateTime(
  iso: string,
  lng: string,
  opts: Intl.DateTimeFormatOptions & { timeZone?: string | undefined } = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
) {
  const { timeZone, ...rest } = opts;
  return new Intl.DateTimeFormat(lng, { ...rest, ...(timeZone ? { timeZone } : {}) }).format(
    new Date(iso),
  );
}

export function fmtDate(
  iso: string,
  lng: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00Z") : new Date(iso);
  return new Intl.DateTimeFormat(lng, { ...opts, timeZone: "UTC" }).format(d);
}
