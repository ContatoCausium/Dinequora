import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import type { InventoryItem } from "@/lib/inventory-service";
import type { Supplier } from "@/lib/suppliers-purchases-service";

const api = vi.hoisted(() => ({
  fetchInventoryConsumption: vi.fn(),
  saveOperationalRecord: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/operational.functions", () => api);
vi.mock("sonner", () => ({ toast }));

import { PurchaseForecastPanel } from "@/components/inventory/purchase-forecast-panel";
import { OperationalCreateDialog } from "@/components/app/operational-create-dialogs";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
// A block body: mockReset() returns the mock, and a function returned by beforeEach runs as teardown.
beforeEach(() => {
  api.fetchInventoryConsumption.mockReset();
  api.saveOperationalRecord.mockReset();
});
afterEach(cleanup);

const ITEMS = [
  {
    id: "buns",
    orgId: "org-1",
    locationId: "store-1",
    name: "Buns",
    category: "bakery",
    sku: "",
    unit: "units",
    quantity: 10,
    minQuantity: 4,
    costCents: 35,
    supplier: "Bakery Co",
    active: true,
    updatedAt: "2026-11-27T00:00:00Z",
  },
] as unknown as InventoryItem[];
const SUPPLIERS = [{ id: "sup-1", name: "bakery co" }] as unknown as Supplier[];

describe("purchase forecast → purchase order", () => {
  it("the Order button hands over the suggested line", async () => {
    api.fetchInventoryConsumption.mockResolvedValue([{ inventory_item_id: "buns", consumed: 60 }]);
    const onOrder = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PurchaseForecastPanel
          orgId="org-1"
          locationId="store-1"
          items={ITEMS}
          storeName={null}
          unitLabel={(u) => u}
          onOrder={onOrder}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Start a purchase order for Buns" }));
    // 60/30 = 2 per day; 2 x 7 + 4 - 10 = 8
    expect(onOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "buns", suggested: 8 }));
  });

  it("without permission to buy there is no Order button", async () => {
    api.fetchInventoryConsumption.mockResolvedValue([{ inventory_item_id: "buns", consumed: 60 }]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PurchaseForecastPanel
          orgId="org-1"
          locationId="store-1"
          items={ITEMS}
          storeName={null}
          unitLabel={(u) => u}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Buns")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a purchase order/ })).toBeNull();
  });

  it("the new purchase order opens filled with the item, quantity, price and supplier, and saves it", async () => {
    api.saveOperationalRecord.mockResolvedValue({ id: "po-1" });
    render(
      <OperationalCreateDialog
        kind="purchase"
        open
        onOpenChange={() => {}}
        orgId="org-1"
        locationId="store-1"
        items={ITEMS}
        suppliers={SUPPLIERS}
        onSaved={async () => {}}
        initial={{
          itemId: "buns",
          quantity: 8,
          unitPriceCents: 35,
          supplierId: "sup-1",
          locationId: "store-1",
        }}
      />,
    );
    const dlg = await screen.findByRole("dialog", { name: "New purchase order" });
    expect(within(dlg).getByLabelText("Quantity")).toHaveValue(8);
    fireEvent.click(within(dlg).getByRole("button", { name: /save|create/i }));
    await waitFor(() => expect(api.saveOperationalRecord).toHaveBeenCalledTimes(1));
    expect(api.saveOperationalRecord.mock.calls[0]![0].data).toMatchObject({
      orgId: "org-1",
      locationId: "store-1",
      kind: "purchase",
      payload: {
        supplierId: "sup-1",
        items: [{ inventoryItemId: "buns", quantityOrdered: 8, unitPriceCents: 35 }],
      },
    });
  });
});
