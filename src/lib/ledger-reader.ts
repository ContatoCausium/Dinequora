import {
  localDay,
  localDayCache,
  shiftDay,
  startOfLocalDay,
  zonedParts,
  zonedTimeToUtc,
} from "./store-time";

/**
 * Complete reads of the financial ledger (finance_entries) — wave 0.
 *
 * PostgREST returns at most 1,000 rows per request (PGRST_DB_MAX_ROWS). A single unpaged read
 * silently drops the rest; this module never does:
 *
 * - Keyset pagination per store on (created_at, id), ascending: deterministic, no OFFSET, so rows
 *   inserted while reading are never skipped or read twice. The cursor uses the timestamp string
 *   exactly as PostgreSQL returned it (microseconds), never a JS Date (milliseconds).
 * - The window ends at `readUntil`, fixed when the read starts: rows recorded afterwards belong to
 *   the next refresh, so a read is a consistent cut of the ledger at that instant.
 * - An exact count before and after the read. Rows read must equal both; otherwise the store is
 *   read once more, and a second mismatch marks the result incomplete ("count_mismatch"). This also
 *   catches a server page limit smaller than requested (the reader adapts the page size).
 * - A row budget (default 150,000 per request) protects the server; when it runs out the result is
 *   marked incomplete ("row_cap"). Any request error throws: never a partial total presented as
 *   complete.
 * - Rows are folded into small accumulators as they arrive (memory stays proportional to the
 *   number of store-days, not to the number of rows).
 *
 * Consistency limit (documented): a transaction that commits AFTER the read passed its position
 * with a created_at BEFORE readUntil is not included (its row did not exist when that page was
 * read); the final recount detects it and triggers the one re-read. Sales commit in milliseconds.
 */

export const LEDGER_PAGE_SIZE = 1000;
export const LEDGER_MAX_ROWS = 150_000;

const COLUMNS = "id,kind,amount_cents,created_at,location_id,order_id";

export interface LedgerRow {
  id: string;
  kind: string;
  amount_cents: number;
  created_at: string;
  location_id: string;
  order_id: string | null;
}

/** A store as the reader needs it: database id and IANA zone. */
export interface LedgerStore {
  id: string;
  timeZone: string;
}

export type ReadIncompleteReason = "row_cap" | "count_mismatch";

export class LedgerReadError extends Error {
  constructor(public readonly detail: string) {
    super("ledger_read_failed");
  }
}

/** Minimal query surface used here (supabase-js PostgrestFilterBuilder), so tests can fake it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
export interface LedgerClient {
  from(table: "finance_entries"): { select(columns: string, opts?: unknown): Query };
}

interface ReadWindow {
  startIso: string | null;
  endIso: string;
}

interface Budget {
  remaining: number;
}

interface Sink {
  add(row: LedgerRow): void;
}

function scoped(client: LedgerClient, orgId: string, storeId: string, w: ReadWindow, head = false) {
  let q = client
    .from("finance_entries")
    .select(head ? "id" : COLUMNS, head ? { count: "exact", head: true } : undefined)
    .eq("org_id", orgId)
    .eq("location_id", storeId)
    .lt("created_at", w.endIso);
  if (w.startIso) q = q.gte("created_at", w.startIso);
  return q;
}

async function countRows(client: LedgerClient, orgId: string, storeId: string, w: ReadWindow) {
  const { count, error } = await scoped(client, orgId, storeId, w, true);
  if (error || count == null) throw new LedgerReadError(error?.message ?? "count_unavailable");
  return count as number;
}

/**
 * One attempt to read every row of a store in a window into a fresh sink. Returns the sink and
 * whether the rows read match the exact count taken before and after.
 */
async function attempt<S extends Sink>(
  client: LedgerClient,
  orgId: string,
  storeId: string,
  w: ReadWindow,
  makeSink: () => S,
  budget: Budget,
  pageSize: number,
): Promise<{ sink: S; rows: number; matched: boolean; capped: boolean }> {
  const sink = makeSink();
  const expected = await countRows(client, orgId, storeId, w);
  let rows = 0;
  let size = pageSize;
  let cursor: { at: string; id: string } | null = null;
  for (;;) {
    if (budget.remaining <= 0) {
      // Out of budget: done only if everything expected was already read (verified below).
      if (rows >= expected) break;
      return { sink, rows, matched: false, capped: true };
    }
    let q = scoped(client, orgId, storeId, w)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(Math.min(size, budget.remaining));
    if (cursor)
      q = q.or(`created_at.gt."${cursor.at}",and(created_at.eq."${cursor.at}",id.gt.${cursor.id})`);
    const { data, error } = await q;
    if (error) throw new LedgerReadError(error.message);
    const page = (data ?? []) as LedgerRow[];
    if (page.length === 0) break;
    for (const row of page) sink.add(row);
    rows += page.length;
    budget.remaining -= page.length;
    const last = page[page.length - 1]!;
    cursor = { at: last.created_at, id: last.id };
    if (page.length < size) {
      if (rows >= expected) break;
      // The server returned fewer rows than requested while more exist: its page limit is lower.
      size = page.length;
    }
  }
  const final = await countRows(client, orgId, storeId, w);
  return { sink, rows, matched: rows === expected && rows === final, capped: false };
}

/** Reads one store completely (one re-read on a count mismatch). */
async function readStore<S extends Sink>(
  client: LedgerClient,
  orgId: string,
  storeId: string,
  w: ReadWindow,
  makeSink: () => S,
  budget: Budget,
  pageSize: number,
): Promise<{ sink: S; rows: number; reason: ReadIncompleteReason | null }> {
  let result = await attempt(client, orgId, storeId, w, makeSink, budget, pageSize);
  if (result.capped) return { sink: result.sink, rows: result.rows, reason: "row_cap" };
  if (!result.matched) {
    result = await attempt(client, orgId, storeId, w, makeSink, budget, pageSize);
    if (result.capped) return { sink: result.sink, rows: result.rows, reason: "row_cap" };
    if (!result.matched) return { sink: result.sink, rows: result.rows, reason: "count_mismatch" };
  }
  return { sink: result.sink, rows: result.rows, reason: null };
}

// ── Summary (screens) ──────────────────────────────────────────────────────────────────────────

export interface LedgerBucket {
  /** Store database id. */
  locationId: string;
  /** Local calendar day of the store (YYYY-MM-DD). */
  day: string;
  kind: string;
  amountCents: number;
  /** Ledger rows in the bucket (for kind "revenue": one per sale). */
  entries: number;
}

export interface LedgerStoreWindow {
  locationId: string;
  timeZone: string;
  /** The store's local today at readUntil. */
  today: string;
  /** First local day read (null = whole history). */
  sinceDay: string | null;
}

export interface LedgerTotals {
  locationId: string;
  revenueCents: number;
  cogsCents: number;
  sales: number;
}

export interface LedgerSummary {
  readUntil: string;
  stores: LedgerStoreWindow[];
  buckets: LedgerBucket[];
  /** Per store: yesterday from local midnight up to the same local time as readUntil. */
  sameTimeYesterday?: LedgerTotals[];
  rowsRead: number;
  complete: boolean;
  reason?: ReadIncompleteReason;
}

class DaySink implements Sink {
  readonly buckets = new Map<string, LedgerBucket>();
  // One Intl call per local day instead of one per row (Workers CPU budget); identical result.
  private readonly dayOf: (at: string) => string;
  constructor(
    private readonly store: LedgerStore,
    private readonly sinceDay: string | null,
    private readonly untilDay: string,
  ) {
    this.dayOf = localDayCache(store.timeZone);
  }
  add(row: LedgerRow) {
    const day = this.dayOf(row.created_at);
    if ((this.sinceDay !== null && day < this.sinceDay) || day > this.untilDay) return;
    const key = `${day}|${row.kind}`;
    const b = this.buckets.get(key) ?? {
      locationId: this.store.id,
      day,
      kind: row.kind,
      amountCents: 0,
      entries: 0,
    };
    b.amountCents += row.amount_cents;
    b.entries += 1;
    this.buckets.set(key, b);
  }
}

class TotalsSink implements Sink {
  revenueCents = 0;
  cogsCents = 0;
  sales = 0;
  add(row: LedgerRow) {
    if (row.kind === "revenue") {
      this.revenueCents += row.amount_cents;
      this.sales += 1;
    } else if (row.kind === "reversal_revenue") {
      this.revenueCents -= row.amount_cents;
      this.sales -= 1;
    } else if (row.kind === "cogs") this.cogsCents += row.amount_cents;
    else if (row.kind === "reversal_cogs") this.cogsCents -= row.amount_cents;
  }
}

/**
 * Day totals per store for the last `days` local days of each store (null = whole history), read
 * completely or explicitly marked incomplete.
 */
export async function readLedgerSummary(
  client: LedgerClient,
  input: {
    orgId: string;
    stores: readonly LedgerStore[];
    days: number | null;
    sameTimeYesterday?: boolean | undefined;
    now?: Date | undefined;
    pageSize?: number | undefined;
    maxRows?: number | undefined;
  },
): Promise<LedgerSummary> {
  const now = input.now ?? new Date();
  const readUntil = now.toISOString();
  const budget: Budget = { remaining: input.maxRows ?? LEDGER_MAX_ROWS };
  const pageSize = input.pageSize ?? LEDGER_PAGE_SIZE;
  const windows: LedgerStoreWindow[] = [];
  const buckets: LedgerBucket[] = [];
  const yesterday: LedgerTotals[] = [];
  let rowsRead = 0;
  let reason: ReadIncompleteReason | undefined;
  let capped = false;

  for (const store of input.stores) {
    const today = localDay(now, store.timeZone);
    const sinceDay = input.days === null ? null : shiftDay(today, -(Math.max(1, input.days) - 1));
    windows.push({ locationId: store.id, timeZone: store.timeZone, today, sinceDay });
    if (capped) continue; // budget exhausted: the remaining stores are not read
    const w: ReadWindow = {
      startIso: sinceDay ? startOfLocalDay(sinceDay, store.timeZone).toISOString() : null,
      endIso: readUntil,
    };
    const read = await readStore(
      client,
      input.orgId,
      store.id,
      w,
      () => new DaySink(store, sinceDay, today),
      budget,
      pageSize,
    );
    rowsRead += read.rows;
    buckets.push(...read.sink.buckets.values());
    if (read.reason === "row_cap") capped = true;
    if (read.reason && !capped) reason = read.reason;
    if (capped) reason = "row_cap";

    if (input.sameTimeYesterday && !capped) {
      const y = shiftDay(today, -1);
      const t = zonedParts(now, store.timeZone);
      const yw: ReadWindow = {
        startIso: startOfLocalDay(y, store.timeZone).toISOString(),
        endIso: zonedTimeToUtc(y, store.timeZone, {
          hour: t.hour,
          minute: t.minute,
          second: t.second,
        }).toISOString(),
      };
      const yr = await readStore(
        client,
        input.orgId,
        store.id,
        yw,
        () => new TotalsSink(),
        budget,
        pageSize,
      );
      rowsRead += yr.rows;
      if (yr.reason === "row_cap") capped = true;
      if (yr.reason && !capped) reason = yr.reason;
      if (capped) reason = "row_cap";
      yesterday.push({
        locationId: store.id,
        revenueCents: yr.sink.revenueCents,
        cogsCents: yr.sink.cogsCents,
        sales: yr.sink.sales,
      });
    }
  }

  const summary: LedgerSummary = {
    readUntil,
    stores: windows,
    buckets,
    rowsRead,
    complete: reason === undefined,
  };
  if (reason) summary.reason = reason;
  if (input.sameTimeYesterday) summary.sameTimeYesterday = yesterday;
  return summary;
}

// ── Raw rows (Finance export) ─────────────────────────────────────────────────────────────────

class RowSink implements Sink {
  readonly rows: LedgerRow[] = [];
  add(row: LedgerRow) {
    this.rows.push(row);
  }
}

export const LEDGER_EXPORT_MAX_ROWS = 50_000;

/** Every ledger row of the stores (whole history), complete or explicitly marked incomplete. */
export async function readLedgerRows(
  client: LedgerClient,
  input: {
    orgId: string;
    stores: readonly LedgerStore[];
    now?: Date | undefined;
    pageSize?: number | undefined;
    maxRows?: number | undefined;
  },
): Promise<{
  rows: LedgerRow[];
  readUntil: string;
  complete: boolean;
  reason?: ReadIncompleteReason;
}> {
  const readUntil = (input.now ?? new Date()).toISOString();
  const budget: Budget = { remaining: input.maxRows ?? LEDGER_EXPORT_MAX_ROWS };
  const rows: LedgerRow[] = [];
  let reason: ReadIncompleteReason | undefined;
  let capped = false;
  for (const store of input.stores) {
    if (capped) break;
    const read = await readStore(
      client,
      input.orgId,
      store.id,
      { startIso: null, endIso: readUntil },
      () => new RowSink(),
      budget,
      input.pageSize ?? LEDGER_PAGE_SIZE,
    );
    rows.push(...read.sink.rows);
    if (read.reason === "row_cap") capped = true;
    if (read.reason) reason = capped ? "row_cap" : read.reason;
  }
  const out: {
    rows: LedgerRow[];
    readUntil: string;
    complete: boolean;
    reason?: ReadIncompleteReason;
  } = { rows, readUntil, complete: reason === undefined };
  if (reason) out.reason = reason;
  return out;
}

/**
 * The summary of rows already in memory, with exactly the bucketing of readLedgerSummary (store
 * zone, local days, same window). Used by unit tests and by in-memory presentation data; never a
 * substitute for the complete server read.
 */
export function summaryFromRows(
  rows: readonly LedgerRow[],
  input: { stores: readonly LedgerStore[]; days: number | null; now?: Date | undefined },
): LedgerSummary {
  const now = input.now ?? new Date();
  const readUntil = now.toISOString();
  const windows: LedgerStoreWindow[] = [];
  const buckets: LedgerBucket[] = [];
  const yesterday: LedgerTotals[] = [];
  for (const store of input.stores) {
    const today = localDay(now, store.timeZone);
    const sinceDay = input.days === null ? null : shiftDay(today, -(Math.max(1, input.days) - 1));
    windows.push({ locationId: store.id, timeZone: store.timeZone, today, sinceDay });
    const sink = new DaySink(store, sinceDay, today);
    const totals = new TotalsSink();
    const y = shiftDay(today, -1);
    const t = zonedParts(now, store.timeZone);
    const yStart = startOfLocalDay(y, store.timeZone).getTime();
    const yEnd = zonedTimeToUtc(y, store.timeZone, t).getTime();
    for (const row of rows) {
      if (row.location_id !== store.id || Date.parse(row.created_at) >= now.getTime()) continue;
      sink.add(row);
      const at = Date.parse(row.created_at);
      if (at >= yStart && at < yEnd) totals.add(row);
    }
    buckets.push(...sink.buckets.values());
    yesterday.push({
      locationId: store.id,
      revenueCents: totals.revenueCents,
      cogsCents: totals.cogsCents,
      sales: totals.sales,
    });
  }
  return {
    readUntil,
    stores: windows,
    buckets,
    sameTimeYesterday: yesterday,
    rowsRead: rows.length,
    complete: true,
  };
}
