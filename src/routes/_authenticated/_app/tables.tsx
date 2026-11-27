import { createFileRoute } from "@tanstack/react-router";
import { TablesPage } from "@/components/pages/tables-page";

export const Route = createFileRoute("/_authenticated/_app/tables")({
  head: () => ({
    meta: [
      { title: "Tables · Dinequora" },
      {
        name: "description",
        content: "Dining room sections, tables and table status of an authorized store.",
      },
      { property: "og:title", content: "Tables · Dinequora" },
      {
        property: "og:description",
        content: "Dining room sections, tables and table status of an authorized store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TablesPage,
});
