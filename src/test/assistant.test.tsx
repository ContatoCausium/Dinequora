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
      itemSales: [],
      recipeCosts: [],
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

  it("best sellers come from the aggregated sales of every store; stock at or below its minimum", () => {
    const sale = (store: string, product: string, units: number, sales: number) => ({
      location_id: store,
      product_id: product.toLowerCase(),
      product_name: product,
      units,
      sales_cents: sales,
    });
    const snap = buildAssistantSnapshot({
      organization: "Test Kitchen",
      stores,
      ledger: null,
      inventory: [
        { name: "Buns", unit: "units", quantity: 4, min_quantity: 10, location_id: "s1" },
        { name: "Beef", unit: "lb", quantity: 30, min_quantity: 10, location_id: "s1" },
      ],
      itemSales: [
        sale("s1", "Burger", 2, 2400),
        sale("s2", "Burger", 1, 1200),
        sale("s2", "Soda", 3, 825),
        sale("s1", "Fries", 4, 1600),
      ],
      recipeCosts: [
        { productId: "burger", locationId: "s1", costPerServingCents: 400 },
        { productId: "burger", locationId: "s2", costPerServingCents: 400 },
        { productId: "soda", locationId: "s2", costPerServingCents: 60 },
      ],
      openOrders: null,
      now: "2026-11-27T15:00:00Z",
    });
    expect(snap.bestSellersLast30Days).toEqual([
      { product: "Burger", quantity: 3, salesCents: 3600 },
      { product: "Fries", quantity: 4, salesCents: 1600 },
      { product: "Soda", quantity: 3, salesCents: 825 },
    ]);
    // Burger: 3 units, margin 12.00 - 4.00 = 8.00; Soda: 3 units, 2.75 - 0.60 = 2.15; Fries: no recipe
    expect(snap.menuEngineeringLast30Days?.dishes).toEqual([
      {
        dish: "Burger",
        class: "star",
        sold: 3,
        avgPriceCents: 1200,
        recipeCostCents: 400,
        marginPerUnitCents: 800,
      },
      {
        dish: "Soda",
        class: "plowhorse",
        sold: 3,
        avgPriceCents: 275,
        recipeCostCents: 60,
        marginPerUnitCents: 215,
      },
    ]);
    expect(snap.menuEngineeringLast30Days?.soldWithoutRecipeCost).toEqual(["Fries"]);
    expect(snap.stockAtOrBelowMinimum).toEqual([
      { item: "Buns", store: "Downtown", quantity: 4, minimum: 10, unit: "units" },
    ]);
    // what the member cannot read stays "not available", never zero
    expect(snap.ledgerLast30Days).toBeNull();
    expect(snap.openOrdersNow).toBeNull();
  });

  it("without cost visibility there is no menu engineering; without sales, no best sellers", () => {
    const base = {
      organization: "Test Kitchen",
      stores,
      ledger: null,
      inventory: null,
      openOrders: null,
      now: "2026-11-27T15:00:00Z",
    };
    const noCosts = buildAssistantSnapshot({
      ...base,
      itemSales: [
        {
          location_id: "s1",
          product_id: "b",
          product_name: "Burger",
          units: 1,
          sales_cents: 1200,
        },
      ],
      recipeCosts: null,
    });
    expect(noCosts.bestSellersLast30Days).toHaveLength(1);
    expect(noCosts.menuEngineeringLast30Days).toBeNull();
    const noSales = buildAssistantSnapshot({ ...base, itemSales: null, recipeCosts: [] });
    expect(noSales.bestSellersLast30Days).toBeNull();
    expect(noSales.menuEngineeringLast30Days).toBeNull();
  });
});

describe("assistant snapshot: purchase forecast", () => {
  it("lists what to buy for 7 days from sales use; no use means no quantity", () => {
    const snap = buildAssistantSnapshot({
      organization: "Test Kitchen",
      stores,
      ledger: null,
      inventory: [
        {
          id: "buns",
          name: "Buns",
          unit: "units",
          quantity: 10,
          min_quantity: 4,
          location_id: "s1",
          supplier: "Bakery",
        },
        {
          id: "napkins",
          name: "Napkins",
          unit: "pack",
          quantity: 1,
          min_quantity: 3,
          location_id: "s1",
        },
      ],
      consumption: [{ inventory_item_id: "buns", consumed: 60 }],
      itemSales: null,
      recipeCosts: null,
      openOrders: null,
      now: "2026-11-27T15:00:00Z",
    });
    // 60/30 = 2 per day; 2 x 7 + 4 - 10 = 8
    expect(snap.purchaseForecastNext7Days?.buy).toEqual([
      {
        item: "Buns",
        store: "Downtown",
        unit: "units",
        onHand: 10,
        usePerDay: 2,
        lastsDays: 5,
        buy: 8,
        supplier: "Bakery",
      },
    ]);
    expect(snap.purchaseForecastNext7Days?.atOrBelowMinimumWithoutSalesUse).toEqual(["Napkins"]);
  });

  it("without the consumption read there is no forecast (not available, never zero)", () => {
    const snap = buildAssistantSnapshot({
      organization: "Test Kitchen",
      stores,
      ledger: null,
      inventory: [],
      consumption: null,
      itemSales: null,
      recipeCosts: null,
      openOrders: null,
      now: "2026-11-27T15:00:00Z",
    });
    expect(snap.purchaseForecastNext7Days).toBeNull();
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

  it("asks the member to wait after a burst of questions", async () => {
    api.askAssistant.mockResolvedValue({ status: "rate_limited" });
    render(<AssistantPanel orgId="org-1" locationId="all" />);
    fireEvent.click(screen.getByRole("button", { name: "How did sales go in the last 7 days?" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "You asked several questions in a row. Wait a minute and ask again.",
      ),
    );
  });
});
