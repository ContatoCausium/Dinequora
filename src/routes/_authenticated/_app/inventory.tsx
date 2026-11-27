import { createFileRoute } from "@tanstack/react-router";
import { InventoryPage } from "@/components/pages/inventory-page";

export const Route = createFileRoute("/_authenticated/_app/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory & Stock Movements · Dinequora" },
      {
        name: "description",
        content: "Store inventory, recipes, suppliers and purchase receiving.",
      },
      { property: "og:title", content: "Inventory & Stock Movements · Dinequora" },
      {
        property: "og:description",
        content: "Store inventory, recipes, suppliers and purchase receiving.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});
