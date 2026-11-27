import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";

const api = vi.hoisted(() => ({ fetchTipsByServer: vi.fn() }));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock("@/lib/operational.functions", () => api);
vi.mock("@/components/app/charts", () => csv);

import { TipsPanel } from "@/components/finance/tips-panel";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
// A block body: mockReset() returns the mock, and a function returned by beforeEach runs as teardown.
beforeEach(() => {
  api.fetchTipsByServer.mockReset();
  csv.downloadCsv.mockReset();
});
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TipsPanel
        orgId="org-1"
        locationId="all"
        storeName={(id) => ({ s1: "Downtown" })[id] ?? id}
      />
    </QueryClientProvider>,
  );

describe("tips by server", () => {
  it("lists each server's tips, cash and non-cash apart, highest first, and exports CSV", async () => {
    api.fetchTipsByServer.mockResolvedValue([
      {
        locationId: "s1",
        serverId: "u2",
        serverName: null,
        tenders: 1,
        tipsCents: 100,
        cashTipsCents: 0,
        paidCents: 500,
      },
      {
        locationId: "s1",
        serverId: "u1",
        serverName: "Sam",
        tenders: 2,
        tipsCents: 500,
        cashTipsCents: 200,
        paidCents: 2000,
      },
    ]);
    renderIt();
    const table = await screen.findByRole("region", { name: "Tips by server and store" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      );
    expect(rows[0]).toEqual(["Sam", "Downtown", "2", "$5.00", "$2.00", "$3.00"]);
    expect(rows[1]![0]).toBe("Unknown server");
    expect(api.fetchTipsByServer).toHaveBeenCalledWith({
      data: { orgId: "org-1", locationId: "all", days: 14 },
    });
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    const [name, , body] = csv.downloadCsv.mock.calls[0]!;
    expect(name).toBe("tips-14d.csv");
    expect(body[0]).toEqual(["Sam", "Downtown", 2, "5.00", "2.00", "3.00", "20.00"]);
  });

  it("no tips in the period: an empty state", async () => {
    api.fetchTipsByServer.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("No tips recorded in the period")).toBeInTheDocument();
  });
});
