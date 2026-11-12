import { createFileRoute } from "@tanstack/react-router";

import { MenuPage } from "@/components/menu/menu-page";

export const Route = createFileRoute("/_authenticated/_app/menu")({
  head: () => ({
    meta: [
      { title: "Menu & Products · Dinequora" },
      {
        name: "description",
        content: "Restaurant products, prices and modifiers with authorized store access.",
      },
      { property: "og:title", content: "Menu & Products · Dinequora" },
      {
        property: "og:description",
        content: "Restaurant products, prices and modifiers with authorized store access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuPage,
});
