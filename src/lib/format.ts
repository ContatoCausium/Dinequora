export function fmtCurrency(v: number, lng: string, compact = false) {
  return new Intl.NumberFormat(lng, {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : v >= 1000 ? 0 : 2,
  }).format(v);
}

/**
 * Money stored as integer cents (every ledger, order, price and cost column).
 * Always pass cents here — never divide by 100 at call sites — so a value can't be shown 100x.
 */
export function fmtMoneyCents(cents: number, lng: string, opts: { compact?: boolean } = {}) {
  return new Intl.NumberFormat(lng, {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.compact ? 0 : 2,
    maximumFractionDigits: opts.compact ? 1 : 2,
  }).format(cents / 100);
}

/** Stock and recipe quantities: at most `digits` decimals, trailing zeros dropped (2.9016 -> "2.9"). */
export function fmtQuantity(v: number, lng: string, digits = 2) {
  return new Intl.NumberFormat(lng, { maximumFractionDigits: digits }).format(v);
}

/** Basis points (888 = 8.88%) shown with the precision the backend actually applies. */
export function fmtBasisPoints(bp: number, lng: string) {
  return new Intl.NumberFormat(lng, { style: "percent", maximumFractionDigits: 2 }).format(
    bp / 10000,
  );
}

export function fmtNumber(v: number, lng: string, compact = false) {
  return new Intl.NumberFormat(lng, {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(v);
}

export function fmtPercent(v: number, lng: string, signed = false) {
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
