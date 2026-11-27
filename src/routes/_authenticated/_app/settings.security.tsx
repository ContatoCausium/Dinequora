import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/components/pages/security-page";

export const Route = createFileRoute("/_authenticated/_app/settings/security")({
  head: () => ({
    meta: [
      { title: "Security · Dinequora" },
      { name: "description", content: "Two-step verification for your Dinequora account." },
    ],
  }),
  component: SecurityPage,
});
