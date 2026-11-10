import { describe, expect, it } from "vitest";

import {
  ORDER_HISTORY_CAP,
  ORDER_PAGE_SIZE,
  fetchAllOrders,
  type RecordedOrder,
} from "../lib/recorded-data";

type Row = { id: string; createdAt: string; totalCents: number };
type Req = { data: { offset: number; limit: number } };

/**
 * Page source that behaves like the database after the fix: rows ordered by (createdAt desc,
 * id desc), read by offset, with `count` taken at the moment of each request. `beforePage` can add
 * rows between requests to simulate sales created while the history is being read.
 */
function database(rows: Row[], beforePage?: (offset: number, rows: Row[]) => void) {
  const calls: number[] = [];
  const fetchPage = async ({ data }: Req) => {
    beforePage?.(data.offset, rows);
    calls.push(data.offset);
    const sorted = [...rows].sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
    );
    const page = sorted.slice(data.offset, data.offset + data.limit);
    return { orders: page as unknown as RecordedOrder[], totalCount: rows.length };
  };
  return { calls, fetchPage };
}

const history = (n: number, sameInstant = false): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `o${String(i).padStart(5, "0")}`,
    createdAt: sameInstant
      ? "2026-11-01T12:00:00.000Z"
      : new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
    totalCents: 100 + (i % 37),
  }));

const sum = (rows: { totalCents: number }[]) => rows.reduce((s, r) => s + r.totalCents, 0);

function expectExactlyOnce(loaded: { id: string }[], expected: Row[]) {
  const ids = loaded.map((o) => o.id);
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
  expect(new Set(ids)).toEqual(new Set(expected.map((r) => r.id))); // no omissions, nothing foreign
}

describe("fetchAllOrders — every order exactly once", () => {
  it("more than 200 orders (450): 3 pages, each order once, totals match", async () => {
    const rows = history(450);
    const db = database(rows);
    const r = await fetchAllOrders("org", "all", undefined, db.fetchPage);
    expect(db.calls).toEqual([0, 200, 400]);
    expectExactlyOnce(r.orders, rows);
    expect(sum(r.orders as unknown as Row[])).toBe(sum(rows));
    expect(r).toMatchObject({ total: 450, truncated: false });
  });

  it("orders sharing the same instant (e.g. an import) are read once each", async () => {
    const rows = history(458, true);
    const r = await fetchAllOrders("org", "all", undefined, database(rows).fetchPage);
    expectExactlyOnce(r.orders, rows);
    expect(sum(r.orders as unknown as Row[])).toBe(sum(rows));
  });

  it("page boundaries: exactly 200 needs one request, 201 needs two", async () => {
    const a = database(history(ORDER_PAGE_SIZE));
    expect((await fetchAllOrders("org", "all", undefined, a.fetchPage)).orders).toHaveLength(200);
    expect(a.calls).toEqual([0]);
    const b = database(history(ORDER_PAGE_SIZE + 1));
    const r = await fetchAllOrders("org", "all", undefined, b.fetchPage);
    expect(b.calls).toEqual([0, 200]);
    expectExactlyOnce(r.orders, history(201));
  });

  it("exactly 5,000 orders: all read, not truncated", async () => {
    const rows = history(ORDER_HISTORY_CAP);
    const db = database(rows);
    const r = await fetchAllOrders("org", "all", undefined, db.fetchPage);
    expect(db.calls).toHaveLength(25);
    expectExactlyOnce(r.orders, rows);
    expect(r).toMatchObject({ total: 5000, truncated: false });
  });

  it("5,001 and 9,000 orders: the newest 5,000 exactly once, truncated", async () => {
    for (const n of [ORDER_HISTORY_CAP + 1, 9000]) {
      const rows = history(n);
      const r = await fetchAllOrders("org", "all", undefined, database(rows).fetchPage);
      expect(r.orders).toHaveLength(5000);
      expectExactlyOnce(r.orders, rows.slice(0, 5000)); // history() is newest first
      expect(sum(r.orders as unknown as Row[])).toBe(sum(rows.slice(0, 5000)));
      expect(r).toMatchObject({ total: n, truncated: true });
    }
  });

  it("a sale created while reading shifts the pages: nothing is counted twice", async () => {
    const rows = history(458);
    const original = [...rows];
    const db = database(rows, (offset, all) => {
      if (offset === 200)
        all.push({ id: "new-1", createdAt: "2026-11-02T00:00:00.000Z", totalCents: 999 });
    });
    const r = await fetchAllOrders("org", "all", undefined, db.fetchPage);
    const ids = r.orders.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of original) expect(ids).toContain(row.id); // nothing already recorded is lost
    expect(sum((r.orders as unknown as Row[]).filter((o) => o.id !== "new-1"))).toBe(sum(original));
    expect(r.truncated).toBe(false); // the late sale arrives on the next load, no false notice
  });

  it("sales arriving before every page: still each order once, none lost", async () => {
    const rows = history(700);
    const original = [...rows];
    let n = 0;
    const db = database(rows, (offset, all) => {
      if (offset > 0)
        all.push({
          id: `late-${n++}`,
          createdAt: `2026-11-0${2 + n}T00:00:00.000Z`,
          totalCents: 1,
        });
    });
    const r = await fetchAllOrders("org", "all", undefined, db.fetchPage);
    const ids = r.orders.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of original) expect(ids).toContain(row.id);
    expect(r.truncated).toBe(false);
  });

  it("an empty history", async () => {
    const r = await fetchAllOrders("org", "all", undefined, database([]).fetchPage);
    expect(r).toEqual({ orders: [], total: 0, truncated: false });
  });
});
