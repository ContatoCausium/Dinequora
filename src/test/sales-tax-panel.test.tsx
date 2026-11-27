import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";

const api = vi.hoisted(() => ({ fetchSalesTaxSummary: vi.fn() }));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/components/app/charts", () => csv);

import { SalesTaxPanel } from "@/components/finance/sales-tax-panel";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
// A block body: mockReset() returns the mock, and a function returned by beforeEach runs as teardown.
beforeEach(() => {
  api.fetchSalesTaxSummary.mockReset();
  csv.downloadCsv.mockReset();
});
afterEach(cleanup);

const NAMES: Record<string, string> = { "db-1": "Downtown", "db-2": "Riverside" };
const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SalesTaxPanel orgId="org-1" locationId="all" storeName={(id) => NAMES[id] ?? id} />
    </QueryClientProvider>,
  );

describe("sales tax report", () => {
  it("lists tax per store and month, newest first, with the effective rate, and exports CSV", async () => {
    api.fetchSalesTaxSummary.mockResolvedValue([
      {
        location_id: "db-1",
        month: "2026-10",
        orders: 1,
        taxable_cents: 4000,
        tax_cents: 250,
        total_cents: 4250,
      },
      {
        location_id: "db-2",
        month: "2026-11",
        orders: 3,
        taxable_cents: 2000,
        tax_cents: 140,
        total_cents: 2140,
      },
      {
        location_id: "db-1",
        month: "2026-11",
        orders: 2,
        taxable_cents: 2800,
        tax_cents: 176,
        total_cents: 2976,
      },
    ]);
    renderIt();
    const table = await screen.findByRole("region", { name: "Sales tax by store and month" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      );
    expect(rows[0]).toEqual(["2026-11", "Downtown", "2", "$28.00", "$1.76", "6.3%"]);
    expect(rows[1]).toEqual(["2026-11", "Riverside", "3", "$20.00", "$1.40", "7%"]);
    expect(rows[2]![0]).toBe("2026-10");
    expect(api.fetchSalesTaxSummary).toHaveBeenCalledWith({
      data: { orgId: "org-1", locationId: "all", months: 3 },
    });
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(csv.downloadCsv).toHaveBeenCalledTimes(1);
    const [name, header, body] = csv.downloadCsv.mock.calls[0]!;
    expect(name).toBe("sales-tax-3m.csv");
    expect(header[0]).toBe("Month");
    expect(body[0]).toEqual(["2026-11", "Downtown", 2, "28.00", "1.76", "6.286", "29.76"]);
  });

  it("asks again for a longer period", async () => {
    api.fetchSalesTaxSummary.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("No taxable sales in the period")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "12 months" }));
    await waitFor(() =>
      expect(api.fetchSalesTaxSummary).toHaveBeenLastCalledWith({
        data: { orgId: "org-1", locationId: "all", months: 12 },
      }),
    );
  });
});
