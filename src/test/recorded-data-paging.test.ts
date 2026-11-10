import { describe, expect, it } from "vitest";

import { fetchAllOrders, type RecordedOrder } from "../lib/recorded-data";

type Req = { data: { offset: number; limit: number } };

/** Page source standing in for the server: `total` orders, served `limit` at a time. */
function source(total: number) {
  const offsets: number[] = [];
  const fetchPage = async ({ data }: Req) => {
    offsets.push(data.offset);
    const n = Math.max(0, Math.min(data.limit, total - data.offset));
    const orders = Array.from({ length: n }, (_, i) => ({ id: `o${data.offset + i}` }));
    return { orders: orders as unknown as RecordedOrder[], totalCount: total };
  };
  return { offsets, fetchPage };
}

// Finance and Reports both load the order history through this paged loader (PR 1: Finance used a
// single page of 200). The UI shows a notice when `truncated` is true.
describe("fetchAllOrders paging", () => {
  it("reads every page of a history below the cap", async () => {
    const s = source(450);
    const r = await fetchAllOrders("org", "all", undefined, s.fetchPage);
    expect(s.offsets).toEqual([0, 200, 400]);
    expect(r.orders).toHaveLength(450);
    expect(r).toMatchObject({ total: 450, truncated: false });
  });

  it("stops at the 5,000-order cap and reports truncation", async () => {
    const s = source(9000);
    const r = await fetchAllOrders("org", "all", undefined, s.fetchPage);
    expect(s.offsets).toHaveLength(25);
    expect(r.orders).toHaveLength(5000);
    expect(r).toMatchObject({ total: 9000, truncated: true });
  });

  it("an empty history is not truncated", async () => {
    const r = await fetchAllOrders("org", "all", undefined, source(0).fetchPage);
    expect(r).toEqual({ orders: [], total: 0, truncated: false });
  });
});
