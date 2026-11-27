import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  LedgerBucket,
  LedgerStore,
  LedgerStoreWindow,
  LedgerSummary,
  LedgerTotals,
} from "./ledger-reader";

/**
 * Ledger summary aggregated by the database (M2, migration 0031 `ledger_day_totals`). One SQL
 * statement — one consistent snapshot — returns the totals per store × local day × kind in each
 * store's own zone, so the result is complete by construction and identical to the ledger rows.
 * It yields exactly the LedgerSummary the screens already consume (same selectors, same figures).
 *
 * Returns null ONLY when the function does not exist yet (migration not applied): the caller then
 * uses the paged reader. Any other error is thrown — never a silent fallback that could hide a
 * permission problem.
 */
export async function readLedgerSummaryAggregated(
  client: SupabaseClient<Database>,
  input: {
    orgId: string;
    stores: readonly LedgerStore[];
    days: number | null;
    sameTimeYesterday?: boolean | undefined;
  },
): Promise<LedgerSummary | null> {
  if (input.stores.length === 0)
    return {
      readUntil: new Date().toISOString(),
      stores: [],
      buckets: [],
      rowsRead: 0,
      complete: true,
      ...(input.sameTimeYesterday ? { sameTimeYesterday: [] } : {}),
    };
  const { data, error } = await client.rpc("ledger_day_totals", {
    _org_id: input.orgId,
    _location_ids: input.stores.map((s) => s.id),
    ...(input.days === null ? {} : { _days: input.days }),
    _same_time_yesterday: input.sameTimeYesterday === true,
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error("ledger_read_failed");
  }
  return toSummary(data, input.stores, input.sameTimeYesterday === true);
}

/** PostgREST "function not in schema cache" or PostgreSQL "undefined function". */
export function isMissingFunction(error: { code?: string | null; message?: string | null }) {
  return error.code === "PGRST202" || error.code === "42883";
}

type Raw = {
  read_until: string;
  stores: { id: string; tz: string; today: string; since: string | null }[];
  buckets: [string, string, string, number, number][];
  yesterday: [string, string, number, number][];
};

/** Maps the function's JSON to a LedgerSummary, in the caller's store order. */
export function toSummary(
  data: unknown,
  stores: readonly LedgerStore[],
  sameTimeYesterday: boolean,
): LedgerSummary {
  const raw = data as Raw | null;
  if (!raw || !Array.isArray(raw.stores) || !Array.isArray(raw.buckets))
    throw new Error("ledger_read_failed");
  const byId = new Map(raw.stores.map((s) => [s.id, s]));
  const windows: LedgerStoreWindow[] = stores.flatMap((st) => {
    const w = byId.get(st.id);
    // A store the caller cannot read is simply absent (RLS on locations), as with the paged reader.
    return w ? [{ locationId: st.id, timeZone: w.tz, today: w.today, sinceDay: w.since }] : [];
  });
  let rowsRead = 0;
  const buckets: LedgerBucket[] = raw.buckets.map(([locationId, day, kind, cents, n]) => {
    rowsRead += Number(n);
    return { locationId, day, kind, amountCents: Number(cents), entries: Number(n) };
  });
  const summary: LedgerSummary = {
    readUntil: new Date(raw.read_until).toISOString(),
    stores: windows,
    buckets,
    rowsRead,
    complete: true,
  };
  if (sameTimeYesterday) {
    const totals = new Map<string, LedgerTotals>(
      windows.map((w) => [
        w.locationId,
        { locationId: w.locationId, revenueCents: 0, cogsCents: 0, sales: 0 },
      ]),
    );
    for (const [locationId, kind, cents, n] of raw.yesterday ?? []) {
      const t = totals.get(locationId);
      if (!t) continue;
      rowsRead += Number(n);
      if (kind === "revenue") {
        t.revenueCents += Number(cents);
        t.sales += Number(n);
      } else if (kind === "reversal_revenue") {
        t.revenueCents -= Number(cents);
        t.sales -= Number(n);
      } else if (kind === "cogs") t.cogsCents += Number(cents);
      else if (kind === "reversal_cogs") t.cogsCents -= Number(cents);
    }
    summary.sameTimeYesterday = [...totals.values()];
    summary.rowsRead = rowsRead;
  }
  return summary;
}
