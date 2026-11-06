export function fmtCurrency(v: number, lng: string, compact = false) {
  return new Intl.NumberFormat(lng, {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : v >= 1000 ? 0 : 2,
  }).format(v);
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

export function fmtDate(
  iso: string,
  lng: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00Z") : new Date(iso);
  return new Intl.DateTimeFormat(lng, { ...opts, timeZone: "UTC" }).format(d);
}
