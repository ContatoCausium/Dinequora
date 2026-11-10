import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KITCHEN_RECENT_DELIVERED,
  ORDER_HISTORY_CAP,
  fetchKitchenBoard,
  type OrderPageRequest,
  type OrderStatus,
  type RecordedOrder,
} from "../lib/recorded-data";
import { filterOrdersByStation } from "../lib/kds-service";
import { createRefreshScheduler } from "../lib/refresh-scheduler";
import type { Order } from "../lib/orders-service";

type Row = { id: string; createdAt: string; status: OrderStatus; productName: string };

/**
 * Page source with the server's semantics: status / statuses filter, total order (createdAt desc,
 * id desc), offset paging, count taken at request time. `beforePage` mutates the table between
 * requests (sales and status changes while the board is being read).
 */
function database(rows: Row[], beforePage?: (req: OrderPageRequest["data"], rows: Row[]) => void) {
  const calls: OrderPageRequest["data"][] = [];
  const fetchPage = async ({ data }: OrderPageRequest) => {
    beforePage?.(data, rows);
    calls.push(data);
    const matching = rows
      .filter((r) => (data.status ? r.status === data.status : true))
      .filter((r) => (data.statuses ? data.statuses.includes(r.status) : true))
      .sort((a, b) =>
        a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
      );
    const page = matching.slice(data.offset, data.offset + data.limit).map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      items: [{ id: `${r.id}-i`, productName: r.productName }],
    }));
    return { orders: page as unknown as RecordedOrder[], totalCount: matching.length };
  };
  return { calls, fetchPage };
}

const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 10, 10, 18) - minutesAgo * 60_000).toISOString();
const rows = (
  n: number,
  status: OrderStatus,
  prefix: string,
  startMinutes = 0,
  product = "Burger",
) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${String(i).padStart(5, "0")}`,
    createdAt: at(startMinutes + i),
    status,
    productName: product,
  }));

function expectExactlyOnce(loaded: { id: string }[], expected: { id: string }[]) {
  const ids = loaded.map((o) => o.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(ids)).toEqual(new Set(expected.map((r) => r.id)));
}

describe("kitchen board — open tickets never disappear", () => {
  it("150 open tickets older than 300 delivered orders: all 150 are shown (old board: 0)", async () => {
    const delivered = rows(300, "delivered", "d", 0); // the 300 most recent orders
    const open = rows(150, "in_prep", "o", 400); // older, still in the kitchen
    const db = database([...delivered, ...open]);
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    const shownOpen = board.orders.filter((o) => o.status !== "delivered");
    expectExactlyOnce(shownOpen, open);
    expect(board.orders.filter((o) => o.status === "delivered")).toHaveLength(
      KITCHEN_RECENT_DELIVERED,
    );
    expect(board).toMatchObject({ openTotal: 150, truncated: false });

    // What the previous board did: the 100 most recent orders of ANY status, filtered in the browser.
    const oldBoard = [...delivered, ...open]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 100)
      .filter((o) => o.status !== "delivered");
    expect(oldBoard).toHaveLength(0);
  });

  it("asks the server for open statuses only, page by page", async () => {
    const db = database([...rows(450, "new", "n", 0), ...rows(20, "delivered", "d", 500)]);
    const board = await fetchKitchenBoard("org", "loc-1", db.fetchPage);
    const openCalls = db.calls.filter((c) => c.statuses);
    expect(openCalls.map((c) => c.offset)).toEqual([0, 200, 400]);
    expect(openCalls.every((c) => c.statuses?.join() === "new,confirmed,in_prep,ready")).toBe(true);
    expect(openCalls.every((c) => c.locationId === "loc-1" && c.limit === 200)).toBe(true);
    expect(db.calls.filter((c) => c.status === "delivered")).toEqual([
      expect.objectContaining({ limit: KITCHEN_RECENT_DELIVERED, offset: 0 }),
    ]);
    expect(board.orders.filter((o) => o.status === "new")).toHaveLength(450);
  });

  it("every open status is kept: new, confirmed, in_prep, ready", async () => {
    const open = [
      ...rows(60, "new", "a", 0),
      ...rows(60, "confirmed", "b", 100),
      ...rows(60, "in_prep", "c", 200),
      ...rows(60, "ready", "e", 300),
    ];
    const db = database([
      ...open,
      ...rows(500, "delivered", "d", 1000),
      ...rows(40, "cancelled", "x", 5),
    ]);
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    expectExactlyOnce(
      board.orders.filter((o) => o.status !== "delivered"),
      open,
    );
    expect(board.orders.some((o) => o.status === "cancelled")).toBe(false);
  });

  it("tickets created during the read are not duplicated; they appear on the next load", async () => {
    const open = rows(450, "new", "o", 10);
    let n = 0;
    const db = database([...open], (req, all) => {
      if (req.statuses && req.offset > 0) all.push(...rows(3, "new", `late${n++}-`, -req.offset));
    });
    const first = await fetchKitchenBoard("org", "all", db.fetchPage);
    const ids = first.orders.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of open) expect(ids).toContain(r.id); // nothing that existed is lost
    const second = await fetchKitchenBoard("org", "all", db.fetchPage);
    expect(second.orders.filter((o) => o.status === "new")).toHaveLength(456);
  });

  it("a ticket bumped to delivered during the read is shown once", async () => {
    const open = rows(250, "ready", "o", 0);
    const db = database([...open], (req, all) => {
      if (req.status === "delivered") {
        const t = all.find((r) => r.id === "o00010");
        if (t) t.status = "delivered";
      }
    });
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    expect(board.orders.filter((o) => o.id === "o00010")).toHaveLength(1);
  });

  it("beyond the browser cap the board says so instead of hiding tickets silently", async () => {
    const db = database(rows(ORDER_HISTORY_CAP + 1, "new", "o", 0));
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    expect(board.orders).toHaveLength(ORDER_HISTORY_CAP);
    expect(board).toMatchObject({ openTotal: ORDER_HISTORY_CAP + 1, truncated: true });
  });

  it("station filters still apply to the full open list", async () => {
    const open = [
      ...rows(120, "new", "g", 0, "Classic Burger"),
      ...rows(80, "new", "f", 200, "French Fries"),
      ...rows(30, "new", "b", 400, "Chocolate Shake"),
    ];
    const db = database([...rows(300, "delivered", "d", -500), ...open]);
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    const live = board.orders.filter((o) => o.status !== "delivered") as unknown as Order[];
    const counts = Object.fromEntries(
      (["grill", "fryer", "bar"] as const).map((s) => [s, filterOrdersByStation(live, s).length]),
    );
    expect(counts).toEqual({ grill: 120, fryer: 80, bar: 30 });
    expect(filterOrdersByStation(live, "all")).toHaveLength(230);
  });
});

describe("refresh scheduler — realtime bursts and ordering", () => {
  afterEach(() => vi.useRealTimers());

  it("a burst of realtime events costs one reload", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const s = createRefreshScheduler(task, 250);
    for (let i = 0; i < 40; i++) void s.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(task).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("an event during a reload triggers exactly one follow-up, so the last change always lands", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const starts: number[] = [];
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          starts.push(Date.now());
          release = resolve;
        }),
    );
    const s = createRefreshScheduler(task, 250);
    void s.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) void s.request(); // events while loading
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1); // never two loads at once
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(task).toHaveBeenCalledTimes(2); // one follow-up for all five events
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("responses are applied in request order (an older response cannot overwrite a newer one)", async () => {
    vi.useFakeTimers();
    const applied: number[] = [];
    let version = 0;
    const durations = [500, 10, 10];
    const s = createRefreshScheduler(async () => {
      const v = ++version;
      await new Promise((r) => setTimeout(r, durations[v - 1] ?? 10));
      applied.push(v);
    }, 0);
    void s.now();
    await vi.advanceTimersByTimeAsync(1);
    void s.now(); // newer data requested while the slow first load is still running
    await vi.advanceTimersByTimeAsync(2000);
    expect(applied).toEqual([1, 2]);
    s.stop();
  });

  it("actions can await fresh data; stop() cancels pending reloads", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const s = createRefreshScheduler(task, 250);
    const done = s.now();
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
    void s.request();
    s.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("a failed reload does not block the next one", async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    const s = createRefreshScheduler(task, 0);
    await s.now();
    await s.now();
    expect(task).toHaveBeenCalledTimes(2);
    s.stop();
  });
});
