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

/**
 * Expense recognition rule shared by Dashboard, Finance, Reports and Insights: an expense counts in
 * a period when its competency date falls inside [since, today]. A cost whose competency date has
 * not arrived yet (a bill scheduled for later in the month) is never anticipated; simulated
 * expenses never count. `sinceDay` null means "from the first record".
 */
export function isRecognizedInPeriod(
  e: { competencyDate: string; isSimulation: boolean },
  sinceDay: string | null,
  todayDay: string,
): boolean {
  return (
    !e.isSimulation &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.competencyDate) &&
    (sinceDay === null || e.competencyDate >= sinceDay) &&
    e.competencyDate <= todayDay
  );
}

/** The expenses recognized in [since, today] (see isRecognizedInPeriod). */
export function recognizedExpenses<T extends { competencyDate: string; isSimulation: boolean }>(
  expenses: readonly T[],
  sinceDay: string | null,
  todayDay: string,
): T[] {
  return expenses.filter((e) => isRecognizedInPeriod(e, sinceDay, todayDay));
}

/** Total of the expenses recognized in [since, today]. */
export function expensesInPeriod<
  T extends { competencyDate: string; isSimulation: boolean; amountCents: number },
>(expenses: readonly T[], sinceDay: string, todayDay: string) {
  return recognizedExpenses(expenses, sinceDay, todayDay).reduce((s, e) => s + e.amountCents, 0);
}
