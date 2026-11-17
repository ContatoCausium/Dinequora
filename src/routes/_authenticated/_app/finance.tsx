import { createFileRoute } from "@tanstack/react-router";
import { FinancePage } from "@/components/pages/finance-page";

export const Route = createFileRoute("/_authenticated/_app/finance")({
  head: () => ({
    meta: [
      { title: "Financial Management · Dinequora" },
      { name: "description", content: "Recorded restaurant revenue, expenses and recipe cost." },
      { property: "og:title", content: "Financial Management · Dinequora" },
      {
        property: "og:description",
        content: "Recorded restaurant revenue, expenses and recipe cost.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePage,
});
