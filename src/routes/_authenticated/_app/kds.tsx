import { createFileRoute } from "@tanstack/react-router";
import { KDSPage } from "@/components/pages/kds-page";

export const Route = createFileRoute("/_authenticated/_app/kds")({
  head: () => ({
    meta: [
      { title: "Kitchen Display System (KDS) · Dinequora" },
      {
        name: "description",
        content: "Authorized restaurant kitchen tickets and recorded status transitions.",
      },
      { property: "og:title", content: "Kitchen Display System (KDS) · Dinequora" },
      {
        property: "og:description",
        content: "Authorized restaurant kitchen tickets and recorded status transitions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KDSPage,
});
