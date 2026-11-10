/**
 * Period helpers shared by Reports, Finance and Intelligence, so revenue, COGS and expenses of one
 * screen always cover the same days. Kept dependency-free to avoid import cycles between the
 * metric modules.
 */

/** Calendar day (YYYY-MM-DD) of a timestamp in a given IANA zone (viewer's zone when omitted). */
export function dayKey(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/** Expenses whose competency date falls in [since, today]. */
export function expensesInPeriod<
  T extends { competencyDate: string; isSimulation: boolean; amountCents: number },
>(expenses: readonly T[], sinceDay: string, todayDay: string) {
  return expenses
    .filter((e) => !e.isSimulation && e.competencyDate >= sinceDay && e.competencyDate <= todayDay)
    .reduce((s, e) => s + e.amountCents, 0);
}
