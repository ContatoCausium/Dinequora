import { createFileRoute } from "@tanstack/react-router";
import { OverviewEntry } from "@/components/pages/overview-page";

export const Route = createFileRoute("/_authenticated/_app/")({
  head: () => ({
    meta: [
      { title: "Executive overview · Dinequora" },
      {
        name: "description",
        content: "Consolidated and per-location sales, orders and operational alerts.",
      },
      { property: "og:title", content: "Executive overview · Dinequora" },
      {
        property: "og:description",
        content: "Consolidated and per-location sales, orders and operational alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewEntry,
});
