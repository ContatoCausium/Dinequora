import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { KitchenCapNotice } from "@/components/kds/kitchen-cap-notice";

import {
  KITCHEN_RECENT_DELIVERED,
  ORDER_HISTORY_CAP,
  fetchKitchenBoard,
  type OrderPageRequest,
  type OrderStatus,
  type RecordedOrder,
} from "../lib/recorded-data";
import { filterOrdersByStation } from "../lib/kds-service";
import { REFRESH_TIMEOUT_MS, createRefreshScheduler } from "../lib/refresh-scheduler";
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
      .sort((a, b) => {
        const newestFirst =
          a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1;
        return data.oldestFirst ? -newestFirst : newestFirst;
      });
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
    expect(openCalls.every((c) => c.oldestFirst === true)).toBe(true); // P5: oldest first
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

  it("tickets created during the read are never duplicated and nothing existing is lost", async () => {
    const open = rows(450, "new", "o", 10);
    let n = 0;
    const db = database([...open], (req, all) => {
      if (req.statuses && req.offset > 0) all.push(...rows(3, "new", `late${n++}-`, -req.offset));
    });
    const first = await fetchKitchenBoard("org", "all", db.fetchPage);
    const ids = first.orders.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of open) expect(ids).toContain(r.id); // nothing that existed is lost
    // Read oldest first, new tickets land at the end of the list: they appear in the same load or,
    // at the latest, in the next one (their realtime event triggers it). Never twice.
    const before = new Set(ids);
    const second = await fetchKitchenBoard("org", "all", db.fetchPage);
    const ids2 = second.orders.map((o) => o.id);
    expect(new Set(ids2).size).toBe(ids2.length);
    for (const id of before) expect(ids2).toContain(id);
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

  it("beyond the 5,000 cap the OLDEST tickets stay; the newest are reported, not dropped silently", async () => {
    // index 0 is the newest (rows() goes back in time), index 5,049 the oldest
    const open = rows(ORDER_HISTORY_CAP + 50, "new", "o", 0);
    const db = database([...open]);
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    expect(board.orders).toHaveLength(ORDER_HISTORY_CAP);
    expect(board).toMatchObject({
      openTotal: ORDER_HISTORY_CAP + 50,
      openLoaded: ORDER_HISTORY_CAP,
      truncated: true,
    });
    const ids = new Set(board.orders.map((o) => o.id));
    expect(open.slice(50).every((r) => ids.has(r.id))).toBe(true); // the 5,000 that waited longest
    expect(open.slice(0, 50).some((r) => ids.has(r.id))).toBe(false); // the 50 newest are left out
  });

  it("the board is still shown newest first, as before", async () => {
    const db = database([...rows(300, "in_prep", "o", 100), ...rows(5, "delivered", "d", 0)]);
    const board = await fetchKitchenBoard("org", "all", db.fetchPage);
    const times = board.orders.map((o) => o.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
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

  it("P3: a reload that never answers is abandoned after 20 s and the next one runs", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const onTimeout = vi.fn();
    const s = createRefreshScheduler(
      (signal) => {
        signals.push(signal);
        calls++;
        return calls === 1 ? new Promise<void>(() => undefined) : Promise.resolve(); // 1st hangs
      },
      { delayMs: 0, onTimeout },
    );
    let actionDone = false;
    void s.now().then(() => (actionDone = true)); // e.g. a "Start" button awaiting fresh data
    await vi.advanceTimersByTimeAsync(1);
    void s.request(); // a realtime event while the first reload hangs
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 10);
    expect(actionDone).toBe(false);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(true); // its late answer must be ignored
    expect(actionDone).toBe(true); // the button is released
    await vi.advanceTimersByTimeAsync(5);
    expect(calls).toBe(2); // the queued update ran
    expect(signals[1]?.aborted).toBe(false);
    s.stop();
  });

  it("P3: a late answer of an abandoned reload never overwrites newer data", async () => {
    vi.useFakeTimers();
    const applied: string[] = [];
    let n = 0;
    const s = createRefreshScheduler(
      async (signal) => {
        const mine = ++n;
        const data = await new Promise<string>((r) =>
          setTimeout(() => r(`v${mine}`), mine === 1 ? 30_000 : 10),
        );
        if (!signal.aborted) applied.push(data);
      },
      { delayMs: 0, timeoutMs: 20_000 },
    );
    void s.now();
    await vi.advanceTimersByTimeAsync(20_001); // v1 abandoned
    void s.now();
    await vi.advanceTimersByTimeAsync(20_000); // v2 applied, then v1 answers late (t = 30 s)
    expect(applied).toEqual(["v2"]);
    s.stop();
  });

  it("P3: failure, then recovery", async () => {
    vi.useFakeTimers();
    const outcomes: string[] = [];
    const task = vi
      .fn()
      .mockImplementationOnce(async () => {
        outcomes.push("failed");
        throw new Error("network");
      })
      .mockImplementation(async () => {
        outcomes.push("ok");
      });
    const s = createRefreshScheduler(task, { delayMs: 0 });
    void s.now();
    await vi.advanceTimersByTimeAsync(1);
    void s.now();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcomes).toEqual(["failed", "ok"]);
    s.stop();
  });

  it("P3: changing store stops the old board: its in-flight answer is not applied", async () => {
    vi.useFakeTimers();
    const board: string[] = [];
    const makeBoard = (store: string, ms: number) => {
      let active = true;
      const s = createRefreshScheduler(
        async (signal) => {
          const data = await new Promise<string>((r) => setTimeout(() => r(store), ms));
          if (active && !signal.aborted) board.push(data);
        },
        { delayMs: 0 },
      );
      void s.now();
      return () => {
        active = false;
        s.stop();
      };
    };
    const closeA = makeBoard("store A", 5_000); // slow answer for the previous store
    await vi.advanceTimersByTimeAsync(10);
    closeA(); // the operator switched to store B
    const closeB = makeBoard("store B", 100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(board).toEqual(["store B"]);
    closeB();
  });
});

describe("P5: kitchen cap notice", () => {
  it("only when tickets are left off; specific text, all stations, both languages", async () => {
    await i18n.changeLanguage("en-US");
    const { container, rerender } = render(
      <KitchenCapNotice openLoaded={460} openTotal={460} truncated={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<KitchenCapNotice openLoaded={5000} openTotal={5050} truncated />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not every open ticket fits on the board");
    expect(alert).toHaveTextContent(
      "Showing the 5000 oldest open tickets of 5050 (all stations). The 50 newest tickets are not on screen",
    );
    expect(alert).not.toHaveTextContent(/figures|orders out of/); // not the finance/report text
    rerender(<KitchenCapNotice openLoaded={5000} openTotal={5001} truncated stationShown={812} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The newest ticket is not on screen");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "812 of the tickets on the board belong to the selected station.",
    );
    await i18n.changeLanguage("pt-BR");
    rerender(<KitchenCapNotice openLoaded={5000} openTotal={5050} truncated stationShown={1} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Exibindo os 5000 tickets abertos mais antigos de 5050 (todas as estações). Os 50 tickets mais recentes não aparecem",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "1 dos tickets no quadro é da estação selecionada.",
    );
    await i18n.changeLanguage("en-US");
  });
});
