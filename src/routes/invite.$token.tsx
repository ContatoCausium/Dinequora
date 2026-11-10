import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MailOpen } from "lucide-react";

import { AuthHeading, AuthLayout, FormAlert, SubmitButton } from "@/components/auth/auth-layout";
import { auth, pendingRedirect, type AuthUser } from "@/lib/auth";
import { acceptInvitation, getInvitation, type InvitationInfo } from "@/lib/org-service";
import { FALLBACK_BRAND } from "@/lib/theme-engine";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Workspace invitation · Dinequora" },
      {
        name: "description",
        content: "Accept your invitation to join a restaurant workspace on Dinequora.",
      },
      { property: "og:title", content: "Workspace invitation · Dinequora" },
      {
        property: "og:description",
        content: "Accept your invitation to join a restaurant workspace on Dinequora.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [inv, setInv] = useState<InvitationInfo | null | undefined>(undefined);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = `/invite/${token}`;

  useEffect(() => {
    void Promise.all([getInvitation(token).catch(() => null), auth.getUser()]).then(([i, u]) => {
      setInv(i);
      setUser(u);
    });
  }, [token]);

  const brand = inv
    ? { primary: inv.brand_primary, accent: FALLBACK_BRAND.accent }
    : FALLBACK_BRAND;

  if (inv === undefined)
    return (
      <AuthLayout>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("invite.loading")}
        </p>
      </AuthLayout>
    );

  if (!inv || inv.status !== "pending") {
    return (
      <AuthLayout brand={brand}>
        <AuthHeading
          title={t("invite.invalidTitle")}
          subtitle={t(`invite.${inv?.status ?? "invalid"}`)}
        />
        <Link to="/auth" className="text-sm font-medium text-primary hover:underline">
          {t("signup.backToLogin")}
        </Link>
      </AuthLayout>
    );
  }

  const role = t(`roles.${inv.role}`);
  const match = user && user.email.toLowerCase() === inv.email;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptInvitation(token);
      await navigate({ to: "/", replace: true });
    } catch (e) {
      setError(
        e instanceof Error && e.message === "email_mismatch"
          ? t("invite.verifyFirst")
          : t("invite.invalid"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout brand={brand} orgName={inv.org_name}>
      <span className="mb-5 inline-flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
        <MailOpen className="size-5" />
      </span>
      <AuthHeading
        eyebrow={t("invite.eyebrow")}
        title={t("invite.title", { org: inv.org_name })}
        subtitle={t("invite.subtitle", { role, email: inv.email })}
      />
      {error && (
        <div className="mb-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
      {match ? (
        <SubmitButton type="button" loading={busy} onClick={join}>
          {t("invite.join")}
        </SubmitButton>
      ) : user ? (
        <div className="flex flex-col gap-4">
          <FormAlert tone="info">
            {t("invite.wrongAccount", { current: user.email, email: inv.email })}
          </FormAlert>
          <button
            className="h-10 rounded-md border bg-card text-sm font-medium hover:bg-muted"
            onClick={async () => {
              await auth.signOut();
              setUser(null);
            }}
          >
            {t("invite.switch")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Link
            to="/signup"
            search={{ redirect: here, email: inv.email }}
            onClick={() => pendingRedirect.set(here)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("invite.createToJoin")}
          </Link>
          <Link
            to="/auth"
            search={{ redirect: here }}
            onClick={() => pendingRedirect.set(here)}
            className="inline-flex h-10 items-center justify-center rounded-md border bg-card text-sm font-medium hover:bg-muted"
          >
            {t("invite.signInToJoin")}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
