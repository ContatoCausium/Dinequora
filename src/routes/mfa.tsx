import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import {
  AuthHeading,
  AuthLayout,
  Field,
  FormAlert,
  SubmitButton,
} from "@/components/auth/auth-layout";
import { auth, AuthError, safeRedirect } from "@/lib/auth";

export const Route = createFileRoute("/mfa")({
  ssr: false,
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Two-step verification · Dinequora" },
      { name: "description", content: "Confirm your sign-in with your authenticator app." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MfaPage,
});

/** The second step of sign-in for accounts with an authenticator app (aal1 -> aal2). */
function MfaPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) return setError(t("mfa.errors.format"));
    setError(null);
    setLoading(true);
    try {
      await auth.mfa.verify(digits);
      await navigate({ to: safeRedirect(redirect) });
    } catch (err) {
      setError(
        err instanceof AuthError && err.code === "invalid_code"
          ? t("mfa.errors.invalid")
          : err instanceof AuthError && err.code === "rate_limited"
            ? t("mfa.errors.rateLimited")
            : t("mfa.errors.unknown"),
      );
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeading title={t("mfa.title")} subtitle={t("mfa.subtitle")} />
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <Field
          id="mfa-code"
          label={t("mfa.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <SubmitButton loading={loading}>{t("mfa.submit")}</SubmitButton>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={async () => {
            await auth.signOut();
            await navigate({ to: "/auth" });
          }}
        >
          {t("mfa.signOut")}
        </button>
      </form>
    </AuthLayout>
  );
}
