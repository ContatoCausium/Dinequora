import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  EMPTY_NAV_COUNTS,
  NAV_COUNT_PERMISSIONS,
  NAV_COUNTS_READ_TIMEOUT_MS,
  NAV_COUNTS_REFRESH_MS,
  NAV_OPEN_STATUSES,
  readNavCounts,
} from "@/lib/nav-counts";
import { DEFAULT_THRESHOLDS } from "@/lib/kds-thresholds";
import { DEFAULT_THRESHOLDS as KDS_SERVICE_THRESHOLDS, getTicketUrgency } from "@/lib/kds-service";
import { OPEN_STATUSES } from "@/lib/recorded-data";
import { ROUTE_PERMISSIONS } from "@/lib/route-permissions";
import { foldForSearch } from "@/lib/search-text";

/** Redesign stage B: sidebar counters (open orders, late kitchen tickets, low stock). */

// ---------- a recording fake of the RLS-bound Supabase client ----------
type Filter = [op: string, column: string, value: unknown];
interface Call {
  table?: string;
  rpc?: string;
  args?: Record<string, unknown>;
  columns?: string;
  head?: boolean;
  filters: Filter[];
  range?: [number, number];
}
function fakeClient(opts: {
  perms?: Partial<Record<string, boolean>>;
  permError?: boolean;
  open?: number | null;
  late?: number | null;
  orderError?: boolean;
  stockRows?: { quantity: number; min_quantity: number }[];
  stockError?: boolean;
  /** Reads that never answer (until aborted). */
  stall?: "stock" | "orders";
}) {
  const calls: Call[] = [];
  const resolve = (c: Call) => {
    if (c.table === "orders") {
      if (opts.orderError) return { count: null, error: { message: "boom" } };
      const late = c.filters.some(([op]) => op === "lte");
      return { count: late ? (opts.late ?? 0) : (opts.open ?? 0), error: null };
    }
    if (opts.stockError) return { data: null, error: { message: "boom" } };
    const [from, to] = c.range ?? [0, 999];
    return { data: (opts.stockRows ?? []).slice(from, to + 1), error: null };
  };
  const from = (table: string) => {
    const call: Call = { table, filters: [] };
    let signal: AbortSignal | undefined;
    const b = {
      abortSignal(s: AbortSignal) {
        signal = s;
        return b;
      },
      select(columns: string, o?: { head?: boolean }) {
        call.columns = columns;
        call.head = !!o?.head;
        return b;
      },
      eq(col: string, v: unknown) {
        call.filters.push(["eq", col, v]);
        return b;
      },
      in(col: string, v: unknown) {
        call.filters.push(["in", col, v]);
        return b;
      },
      lte(col: string, v: unknown) {
        call.filters.push(["lte", col, v]);
        return b;
      },
      order() {
        return b;
      },
      range(f: number, t: number) {
        call.range = [f, t];
        return b;
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        calls.push(call);
        const stalled =
          (opts.stall === "stock" && table === "inventory_items") ||
          (opts.stall === "orders" && table === "orders");
        const answer = stalled
          ? new Promise((_, reject) =>
              signal?.addEventListener("abort", () => reject(new Error("aborted"))),
            )
          : Promise.resolve(resolve(call));
        return answer.then(res, rej);
      },
    };
    return b;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ rpc: fn, args, filters: [] });
    const perm = (args["_perms"] as string[])[0]!;
    const answer = Promise.resolve(
      opts.permError
        ? { data: null, error: { message: "boom" } }
        : { data: opts.perms?.[perm] ?? true, error: null },
    );
    return { abortSignal: () => answer, then: answer.then.bind(answer) };
  };
  return { calls, client: { from, rpc } as unknown as SupabaseClient<Database> };
}

const ORG = "3a9ccc6d-89ca-4430-911c-d58c697383d9";
const STORE = "6e4757e3-4a28-4066-bc50-364f3e3a3f6a";
const NOW = new Date("2026-11-17T12:00:00.000Z");

describe("readNavCounts (server)", () => {
  it("counts real open orders, late tickets and low stock with head-only reads", async () => {
    const { client, calls } = fakeClient({
      open: 15,
      late: 9,
      stockRows: [
        { quantity: 3, min_quantity: 4.8 }, // low
        { quantity: 0, min_quantity: 0 }, // out (counts: needs restocking)
        { quantity: 30, min_quantity: 48 }, // low
        { quantity: 10, min_quantity: 2 }, // ok
      ],
    });
    expect(await readNavCounts(client, { orgId: ORG }, NOW)).toEqual({
      openOrders: 15,
      lateTickets: 9,
      lowStock: 3,
    });
    const orders = calls.filter((c) => c.table === "orders");
    expect(orders).toHaveLength(2);
    for (const c of orders) {
      expect(c.head).toBe(true); // no order rows travel
      expect(c.filters).toContainEqual(["eq", "org_id", ORG]);
      expect(c.filters).toContainEqual(["in", "status", [...NAV_OPEN_STATUSES]]);
      expect(c.filters).toContainEqual(["eq", "is_simulation", false]); // training orders excluded
      expect(c.filters.some(([, col]) => col === "location_id")).toBe(false); // all my stores (RLS)
    }
    // late = created at least warningMinutes (10) ago — the KDS "late" threshold
    expect(orders[1]!.filters).toContainEqual(["lte", "created_at", "2026-11-17T11:50:00.000Z"]);
    const stock = calls.find((c) => c.table === "inventory_items")!;
    expect(stock.columns).toBe("quantity,min_quantity");
    expect(stock.filters).toContainEqual(["eq", "active", true]);
  });

  it("scopes every read to the selected store and checks access to that store", async () => {
    const { client, calls } = fakeClient({ open: 5, late: 5, stockRows: [] });
    await readNavCounts(client, { orgId: ORG, locationId: STORE }, NOW);
    for (const c of calls.filter((c) => c.table))
      expect(c.filters).toContainEqual(["eq", "location_id", STORE]);
    const rpcs = calls.filter((c) => c.rpc);
    expect(rpcs.map((c) => c.rpc)).toEqual(Array(3).fill("has_any_permission"));
    for (const c of rpcs) expect(c.args).toMatchObject({ _org_id: ORG, _location_id: STORE });
  });

  it("never computes a counter the member may not see (null, and no read at all)", async () => {
    const { client, calls } = fakeClient({
      perms: { "orders.view": false, "inventory.view": false },
      open: 15,
      late: 4,
    });
    expect(await readNavCounts(client, { orgId: ORG }, NOW)).toEqual({
      openOrders: null,
      lateTickets: 4,
      lowStock: null,
    });
    expect(calls.filter((c) => c.table === "orders")).toHaveLength(1); // only the kitchen count
    expect(calls.some((c) => c.table === "inventory_items")).toBe(false);
  });

  it("fails closed: a permission check or read error gives null, never a made-up zero", async () => {
    expect(await readNavCounts(fakeClient({ permError: true }).client, { orgId: ORG })).toEqual(
      EMPTY_NAV_COUNTS,
    );
    expect(
      await readNavCounts(fakeClient({ orderError: true, stockError: true }).client, {
        orgId: ORG,
      }),
    ).toEqual(EMPTY_NAV_COUNTS);
  });

  it("a stalled read gives up after the timeout: that counter is null, the others still arrive", async () => {
    const { client } = fakeClient({ open: 7, late: 2, stall: "stock" });
    const t0 = Date.now();
    const counts = await readNavCounts(client, { orgId: ORG, timeoutMs: 40 }, NOW);
    expect(counts).toEqual({ openOrders: 7, lateTickets: 2, lowStock: null });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(NAV_COUNTS_READ_TIMEOUT_MS).toBe(8_000);
  });

  it("reads low stock page by page (never truncated at PostgREST's 1,000-row default)", async () => {
    const stockRows = Array.from({ length: 2500 }, (_, i) => ({
      quantity: i % 5 === 0 ? 1 : 50,
      min_quantity: 10,
    }));
    const { client, calls } = fakeClient({ stockRows });
    const counts = await readNavCounts(client, { orgId: ORG }, NOW);
    expect(counts.lowStock).toBe(500);
    expect(calls.filter((c) => c.table === "inventory_items").map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe("same rules as the screens they point to", () => {
  it("open statuses are the Orders/KDS open statuses", () => {
    expect([...NAV_OPEN_STATUSES]).toEqual([...OPEN_STATUSES]);
  });
  it("late uses the KDS threshold: a ticket the board marks late is counted, a fresh one is not", () => {
    expect(KDS_SERVICE_THRESHOLDS).toBe(DEFAULT_THRESHOLDS);
    const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
    expect(getTicketUrgency(at(10), DEFAULT_THRESHOLDS, NOW)).toBe("warning"); // counted (≥ 10)
    expect(getTicketUrgency(at(9.99), DEFAULT_THRESHOLDS, NOW)).toBe("normal"); // not counted
  });
  it("each counter requires the same permission as the module's route", () => {
    const route = (prefix: string) => ROUTE_PERMISSIONS.find((r) => r.prefix === prefix)!.any;
    expect(route("/orders")).toEqual(NAV_COUNT_PERMISSIONS.openOrders);
    expect(route("/kds")).toEqual(NAV_COUNT_PERMISSIONS.lateTickets);
    // Stock levels need inventory.view (purchases/recipes/suppliers alone open the module, not levels).
    expect(route("/inventory")).toContain(NAV_COUNT_PERMISSIONS.lowStock[0]);
  });
  it("refreshes every 30 seconds", () => {
    expect(NAV_COUNTS_REFRESH_MS).toBe(30_000);
  });
});

// ---------- the client hook ----------
const api = vi.hoisted(() => ({ fetchNavCounts: vi.fn() }));
const workspace = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const presentation = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/components/app/workspace-context", () => ({ useWorkspace: () => workspace.current }));
vi.mock("@/components/app/use-presentation-mode", () => ({
  usePresentationMode: () => ({ active: presentation.active }),
}));
const { useNavCounts, navCountsKey } = await import("@/components/app/use-nav-counts");

function setWorkspace(perms: string[], extra: Record<string, unknown> = {}) {
  workspace.current = {
    org: { id: "org_867c07837752" },
    locationId: "all",
    orgStatus: "active",
    canAny: (req: readonly string[]) => req.some((p) => perms.includes(p)),
    ...extra,
  };
}
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("useNavCounts (client)", () => {
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.fetchNavCounts.mockReset();
    presentation.active = false;
  });
  afterEach(cleanup);

  it("one request for all counters, refreshed every 30 s, paused in background tabs", async () => {
    setWorkspace(["orders.view", "kds.view", "inventory.view"]);
    api.fetchNavCounts.mockResolvedValue({ openOrders: 15, lateTickets: 15, lowStock: 4 });
    const { result } = renderHook(() => useNavCounts(true), { wrapper });
    await waitFor(() => expect(result.current.openOrders).toBe(15));
    expect(result.current).toEqual({ openOrders: 15, lateTickets: 15, lowStock: 4 });
    expect(api.fetchNavCounts).toHaveBeenCalledTimes(1);
    expect(api.fetchNavCounts).toHaveBeenCalledWith({
      data: { orgId: "org_867c07837752", locationId: "all" },
    });
    const observer = qc.getQueryCache().find({ queryKey: navCountsKey("org_867c07837752", "all") })!
      .observers[0]!.options;
    expect(observer.refetchInterval).toBe(30_000);
    expect(observer.refetchIntervalInBackground).toBe(false);
  });

  it("hides what the member may not see even if the server answered it", async () => {
    setWorkspace(["kds.view"]);
    api.fetchNavCounts.mockResolvedValue({ openOrders: 15, lateTickets: 3, lowStock: 4 });
    const { result } = renderHook(() => useNavCounts(true), { wrapper });
    await waitFor(() => expect(result.current.lateTickets).toBe(3));
    expect(result.current).toEqual({ openOrders: null, lateTickets: 3, lowStock: null });
  });

  it("does not poll without permissions, in presentation mode, in focus mode or when suspended", async () => {
    setWorkspace([]);
    renderHook(() => useNavCounts(true), { wrapper });
    setWorkspace(["orders.view"], { orgStatus: "suspended" });
    renderHook(() => useNavCounts(true), { wrapper });
    setWorkspace(["orders.view"]);
    renderHook(() => useNavCounts(false), { wrapper }); // focus mode
    presentation.active = true;
    const { result } = renderHook(() => useNavCounts(true), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.fetchNavCounts).not.toHaveBeenCalled();
    expect(result.current).toEqual(EMPTY_NAV_COUNTS);
  });

  it("shows nothing when the latest read failed (no stale or invented numbers)", async () => {
    // the hook retries once (about 1 s) before giving up
    setWorkspace(["orders.view"]);
    api.fetchNavCounts.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useNavCounts(true), { wrapper });
    await waitFor(
      () =>
        expect(
          qc.getQueryCache().find({ queryKey: navCountsKey("org_867c07837752", "all") })?.state
            .status,
        ).toBe("error"),
      { timeout: 3000 },
    );
    expect(result.current).toEqual(EMPTY_NAV_COUNTS);
  });
});

describe("command palette search", () => {
  it("matches without accents or case", () => {
    expect(foldForSearch("Relatórios")).toBe("relatorios");
    expect(foldForSearch("Configurações")).toBe("configuracoes");
    expect(foldForSearch("Tela da cozinha")).toBe("tela da cozinha");
  });
});
