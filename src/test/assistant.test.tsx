import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { buildAssistantSnapshot } from "@/lib/assistant-snapshot";

/**
 * Management assistant (0040): the data snapshot the model reads, and the panel. The usage ledger,
 * the feature switch and who may ask are covered against a database by
 * scripts/security/assistant_usage_integrity.mjs.
 */
const api = vi.hoisted(() => ({ askAssistant: vi.fn() }));
vi.mock("@/lib/assistant.functions", () => api);

import { AssistantPanel } from "@/components/intelligence/assistant-panel";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
beforeEach(() => api.askAssistant.mockReset());
afterEach(cleanup);

const stores = [
  { id: "s1", name: "Downtown", timezone: "America/New_York" },
  { id: "s2", name: "Riverside", timezone: "America/New_York" },
];

describe("assistant snapshot", () => {
  it("nets reversals, sums per day and per store, and keeps the last 7 and 30 days", () => {
    const snap = buildAssistantSnapshot({
      organization: "Test Kitchen",
      stores,
      ledger: {
        buckets: [
          ["s1", "2026-11-26", "revenue", 10000, 3],
          ["s1", "2026-11-26", "reversal_revenue", 1000, 1],
          ["s1", "2026-11-26", "cogs", 3000, 3],
          ["s2", "2026-11-27", "revenue", 5000, 2],
          ["s2", "2026-11-27", "expense", 2000, 1],
          ["s2", "2026-11-27", "purchase", 9999, 1],
        ],
      },
      inventory: [],
      orders: [],
      openOrders: 2,
      now: "2026-11-27T15:00:00Z",
    });
    expect(snap.ledgerLast30Days?.byDay).toEqual([
      { day: "2026-11-26", salesNetCents: 9000, cogsCents: 3000, expensesCents: 0 },
      { day: "2026-11-27", salesNetCents: 5000, cogsCents: 0, expensesCents: 2000 },
    ]);
    expect(snap.ledgerLast30Days?.byStore).toEqual([
      { store: "Downtown", salesNetCents: 9000, cogsCents: 3000, expensesCents: 0 },
      { store: "Riverside", salesNetCents: 5000, cogsCents: 0, expensesCents: 2000 },
    ]);
    expect(snap.ledgerLast30Days?.last30.salesNetCents).toBe(14000);
    expect(snap.openOrdersNow).toBe(2);
  });

  it("counts only paid, live, real orders in best sellers; lists stock at or below its minimum", () => {
    const item = (product_name: string, quantity: number, subtotal_cents: number) => ({
      product_name,
      quantity,
      subtotal_cents,
    });
    const snap = buildAssistantSnapshot({
      organization: "Test Kitchen",
      stores,
      ledger: null,
      inventory: [
        { name: "Buns", unit: "units", quantity: 4, min_quantity: 10, location_id: "s1" },
        { name: "Beef", unit: "lb", quantity: 30, min_quantity: 10, location_id: "s1" },
      ],
      orders: [
        {
          location_id: "s1",
          status: "delivered",
          is_simulation: false,
          order_items: [item("Burger", 2, 2400)],
          payments: [{ status: "recorded" }],
        },
        {
          location_id: "s1",
          status: "new",
          is_simulation: false,
          order_items: [item("Burger", 9, 9999)],
          payments: [],
        },
        {
          location_id: "s1",
          status: "cancelled",
          is_simulation: false,
          order_items: [item("Soda", 9, 999)],
          payments: [{ status: "reversed" }],
        },
        {
          location_id: "s2",
          status: "delivered",
          is_simulation: true,
          order_items: [item("Soda", 9, 999)],
          payments: [{ status: "recorded" }],
        },
        {
          location_id: "s2",
          status: "ready",
          is_simulation: false,
          order_items: [item("Soda", 3, 825)],
          payments: [{ status: "recorded" }],
        },
      ],
      openOrders: null,
      now: "2026-11-27T15:00:00Z",
    });
    expect(snap.bestSellersLast30Days).toEqual([
      { product: "Burger", quantity: 2, salesCents: 2400 },
      { product: "Soda", quantity: 3, salesCents: 825 },
    ]);
    expect(snap.paidOrdersLast30Days).toBe(2);
    expect(snap.stockAtOrBelowMinimum).toEqual([
      { item: "Buns", store: "Downtown", quantity: 4, minimum: 10, unit: "units" },
    ]);
    // what the member cannot read stays "not available", never zero
    expect(snap.ledgerLast30Days).toBeNull();
    expect(snap.openOrdersNow).toBeNull();
  });
});

describe("assistant panel", () => {
  it("asks with the store scope and the history, and shows the answer", async () => {
    api.askAssistant.mockResolvedValue({
      status: "ok",
      answer: "Sales were $140.00.",
      model: "claude-opus-5-5",
    });
    render(<AssistantPanel orgId="org-1" locationId="all" />);
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "How were sales?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Sales were $140.00.")).toBeInTheDocument();
    expect(api.askAssistant).toHaveBeenCalledWith({
      data: { orgId: "org-1", locationId: "all", question: "How were sales?", history: [] },
    });
  });

  it("says when the assistant is not set up, without failing", async () => {
    api.askAssistant.mockResolvedValue({ status: "not_configured" });
    render(<AssistantPanel orgId="org-1" locationId="all" />);
    fireEvent.click(screen.getByRole("button", { name: "How did sales go in the last 7 days?" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "The assistant is not set up for this workspace yet.",
      ),
    );
  });
});
