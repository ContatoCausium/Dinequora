import { createFileRoute } from "@tanstack/react-router";
import { POSPage } from "@/components/pages/pos-page";

export const Route = createFileRoute("/_authenticated/_app/pos")({
  head: () => ({
    meta: [
      { title: "POS · Dinequora" },
      {
        name: "description",
        content: "Authorized point of sale and server-confirmed restaurant orders.",
      },
      { property: "og:title", content: "POS · Dinequora" },
      {
        property: "og:description",
        content: "Authorized point of sale and server-confirmed restaurant orders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: POSPage,
});
