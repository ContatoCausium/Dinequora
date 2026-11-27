import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";

const api = vi.hoisted(() => ({
  fetchLedgerRows: vi.fn(async () => ({ rows: [], complete: true, reason: undefined })),
}));
vi.mock("@/lib/operational.functions", () => api);

import { FinanceReports } from "@/components/finance/finance-reports";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
afterEach(cleanup);

const renderIt = (ordersLoading: boolean) =>
  render(
    <FinanceReports
      restaurantName="Demo"
      locations={[]}
      currentLocationId="all"
      expenses={[]}
      orgId="org-1"
      trendEntries={[]}
      orders={[]}
      ordersLoading={ordersLoading}
      stores={[]}
      currentMonth="2026-11"
    />,
  );

describe("finance reports while the order history is still loading", () => {
  it("keeps the exports disabled until the orders arrive (Finance shows its figures first)", async () => {
    renderIt(true);
    await waitFor(() => expect(api.fetchLedgerRows).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Print / save PDF" })).toBeDisabled();
  });

  it("enables the exports once the orders and the ledger rows are read", async () => {
    renderIt(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Print / save PDF" })).toBeEnabled();
  });
});
