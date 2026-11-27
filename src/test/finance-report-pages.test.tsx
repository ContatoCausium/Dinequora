import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "@/lib/i18n";

// 60 sales in the ledger: the cash-flow preview lists one row per entry.
const ROWS = Array.from({ length: 60 }, (_, i) => ({
  id: `e${i}`,
  org_id: "org-1",
  location_id: "db-1",
  order_id: null,
  kind: "revenue",
  amount_cents: 1000 + i,
  created_at: new Date(Date.UTC(2026, 10, 1, 12) + i * 60_000).toISOString(),
}));
const api = vi.hoisted(() => ({ fetchLedgerRows: vi.fn() }));
vi.mock("@/lib/operational.functions", () => api);

import { FinanceReports, REPORT_PAGE_SIZE } from "@/components/finance/finance-reports";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
afterEach(cleanup);

const bodyRows = () => screen.getByRole("region").querySelectorAll("tbody tr").length;

describe("finance report preview pages", () => {
  it("shows the report a page at a time, while the export keeps every row", async () => {
    api.fetchLedgerRows.mockResolvedValue({ rows: ROWS, complete: true, reason: undefined });
    render(
      <FinanceReports
        restaurantName="Demo"
        locations={[]}
        currentLocationId="all"
        expenses={[]}
        orgId="org-1"
        trendEntries={[]}
        orders={[]}
        stores={[]}
        currentMonth="2026-11"
      />,
    );
    await waitFor(() => expect(bodyRows()).toBe(REPORT_PAGE_SIZE));
    const pager = screen.getByRole("navigation");
    expect(within(pager).getByText("1–25 of 60")).toBeInTheDocument();
    fireEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(within(pager).getByText("26–50 of 60")).toBeInTheDocument();
    fireEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toBe(10);
    expect(within(pager).getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
