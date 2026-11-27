import { createFileRoute } from "@tanstack/react-router";
import { LocationsPage } from "@/components/pages/locations-page";

export const Route = createFileRoute("/_authenticated/_app/locations")({
  head: () => ({
    meta: [
      { title: "Locations · Dinequora" },
      {
        name: "description",
        content: "Manage restaurant locations, hours, time zones and store managers.",
      },
      { property: "og:title", content: "Locations · Dinequora" },
      {
        property: "og:description",
        content: "Manage restaurant locations, hours, time zones and store managers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocationsPage,
});
