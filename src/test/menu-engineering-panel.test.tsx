import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";

const api = vi.hoisted(() => ({ fetchMenuItemSales: vi.fn() }));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/components/app/charts", () => csv);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { MenuEngineeringPanel } from "@/components/intelligence/menu-engineering-panel";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
// A block body: mockReset() returns the mock, and a function returned by beforeEach runs as teardown.
beforeEach(() => {
  api.fetchMenuItemSales.mockReset();
});
afterEach(cleanup);

const renderIt = (recipes = RECIPES) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MenuEngineeringPanel orgId="org-1" locationId="store-1" periodDays={30} recipes={recipes} />
    </QueryClientProvider>,
  );
const sale = (p: string, units: number, sales: number) => ({
  location_id: "db-1",
  product_id: p,
  product_name: p[0]!.toUpperCase() + p.slice(1),
  units,
  sales_cents: sales,
});
const RECIPES = [
  { productId: "burger", locationId: "db-1", costPerServingCents: 400 },
  { productId: "fries", locationId: "db-1", costPerServingCents: 100 },
  { productId: "steak", locationId: "db-1", costPerServingCents: 1200 },
  { productId: "salad", locationId: "db-1", costPerServingCents: 700 },
];

describe("menu engineering panel", () => {
  it("asks for the store and period, then shows each dish with its class and figures", async () => {
    api.fetchMenuItemSales.mockResolvedValue([
      sale("burger", 80, 80_000),
      sale("fries", 80, 32_000),
      sale("steak", 20, 60_000),
      sale("salad", 20, 18_000),
      sale("special", 3, 4_500),
    ]);
    renderIt();
    const table = await screen.findByRole("region", { name: "Dishes sold, by class" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Burger",
      "Fries",
      "Steak",
      "Salad",
    ]);
    expect(within(rows[0]!).getByText("Star")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("$6.00")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Dog")).toBeInTheDocument();
    expect(
      screen.getByText("1 dish sold without a recipe cost is not classified: Special."),
    ).toBeInTheDocument();
    expect(screen.getByText(/High margin: at least \$5\.60 per unit/)).toBeInTheDocument();
    expect(api.fetchMenuItemSales).toHaveBeenCalledWith({
      data: { orgId: "org-1", locationId: "store-1", days: 30 },
    });
    // CSV: classified dishes first, then the ones without a recipe cost (blank cost and margin)
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    const [name, header, body] = csv.downloadCsv.mock.calls.at(-1)!;
    expect(name).toBe("menu-engineering-30d.csv");
    expect(header[0]).toBe("Dish");
    expect(body[0]).toEqual(["Burger", "Star", 80, "40.0", "10.00", "4.00", "6.00"]);
    expect(body.at(-1)).toEqual(["Special", "", 3, "", "15.00", "", ""]);
  });

  it("no sales: an empty state, never invented figures", async () => {
    api.fetchMenuItemSales.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("No dish sold in the period")).toBeInTheDocument();
  });

  it("a failed read says so", async () => {
    api.fetchMenuItemSales.mockImplementation(() =>
      Promise.reject(new Error("menu_sales_read_failed")),
    );
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sales per dish could not be loaded. Try again.",
    );
  });
});
