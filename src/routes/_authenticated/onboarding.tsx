import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { onboardingSearch } from "@/lib/onboarding-search";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Mail } from "lucide-react";

import {
  AuthHeading,
  AuthLayout,
  Field,
  FormAlert,
  SubmitButton,
} from "@/components/auth/auth-layout";
import { auth } from "@/lib/auth";
import { createTestRestaurant, fetchMemberships } from "@/lib/org-service";
import { isPlatformAdmin } from "@/lib/admin-service";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: onboardingSearch,
  head: () => ({
    meta: [
      { title: "Set up your workspace · Servora" },
      {
        name: "description",
        content: "Create your restaurant workspace or join one by invitation.",
      },
      { property: "og:title", content: "Set up your workspace · Servora" },
      {
        property: "og:description",
        content: "Create your restaurant workspace or join one by invitation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Platform administrators never need a restaurant; send them to the Control Center
  // unless they explicitly chose to create a workspace (?create=1).
  beforeLoad: async ({ context, search }) => {
    if (search.create === "1") return;
    if ((await isPlatformAdmin()) && (await fetchMemberships(context.user.id)).length === 0)
      throw redirect({ to: "/control" });
  },
  component: Onboarding,
});

function Onboarding() {
  const { t } = useTranslation("team");
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [loc, setLoc] = useState("");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [err, setErr] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setErr(t("auth:errors.required"));
    setErr(undefined);
    setError(null);
    setLoading(true);
    try {
      const createdId = await createTestRestaurant(
        name.trim(),
        company.trim(),
        address.trim(),
        loc.trim(),
      );
      const memberships = await fetchMemberships(user.id);
      const created = memberships.find((m) => m.dbId === createdId);
      if (created) localStorage.setItem("servora.org", created.org.id);
      toast.success(t("onboarding.created"));
      await router.invalidate();
      await navigate({ to: "/settings/branding", replace: true });
    } catch (e) {
      setError(e instanceof Error && e.message === "org_limit" ? "org_limit" : "unknown");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeading
        eyebrow={t("onboarding.eyebrow")}
        title={t("onboarding.title")}
        subtitle={t("onboarding.subtitle")}
      />
      <div className="mb-6 rounded-lg border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("onboarding.stepsTitle")}
        </p>
        <ol className="mt-3 flex flex-col gap-2.5">
          {(["step1", "step2", "step3"] as const).map((k, i) => (
            <li key={k} className="flex items-start gap-3 text-sm">
              <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span>{t(`onboarding.${k}`)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          {t("onboarding.trialNote")}
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <FormAlert>{t(`auth:errors.${error}`)}</FormAlert>}
        <Field
          id="org"
          label={t("onboarding.orgName")}
          placeholder={t("onboarding.orgPlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={err}
          maxLength={80}
        />
        <Field
          id="company"
          label={t("onboarding.companyName")}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          maxLength={120}
        />
        <Field
          id="address"
          label={t("onboarding.companyAddress")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={240}
        />
        <Field
          id="loc"
          label={t("onboarding.location")}
          hint={t("onboarding.locationHint")}
          placeholder={t("onboarding.locationPlaceholder")}
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          maxLength={80}
        />
        <SubmitButton loading={loading}>{t("onboarding.submit")}</SubmitButton>
      </form>
      <div className="mt-8 rounded-lg border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="size-4 text-muted-foreground" />
          {t("onboarding.invitedTitle")}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("onboarding.invitedBody", { email: user.email })}
        </p>
        <Button
          variant="ghost"
          onClick={async () => {
            await auth.signOut();
            await navigate({ to: "/auth", replace: true });
          }}
          className="mt-3"
        >
          {t("onboarding.signOut")}
        </Button>
      </div>
    </AuthLayout>
  );
}
