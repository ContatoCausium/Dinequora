import { createFileRoute } from "@tanstack/react-router";
import { IntelligencePage } from "@/components/pages/intelligence-page";

export const Route = createFileRoute("/_authenticated/_app/intelligence")({
  head: () => ({
    meta: [
      { title: "Insights · Dinequora" },
      {
        name: "description",
        content: "Revenue, food cost and stock signals calculated from recorded operations.",
      },
      { property: "og:title", content: "Insights · Dinequora" },
      {
        property: "og:description",
        content: "Revenue, food cost and stock signals calculated from recorded operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntelligencePage,
});
