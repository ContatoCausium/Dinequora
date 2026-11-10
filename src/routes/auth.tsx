import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import {
  AuthHeading,
  AuthLayout,
  Field,
  FormAlert,
  isEmail,
  PasswordField,
  SocialButtons,
  SubmitButton,
} from "@/components/auth/auth-layout";
import { isPlatformAdmin } from "@/lib/admin-service";
import { auth, AuthError, pendingRedirect, safeRedirect, sessionPersistence } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in · Dinequora" },
      {
        name: "description",
        content: "Sign in to your Dinequora restaurant operations workspace.",
      },
      { property: "og:title", content: "Sign in · Dinequora" },
      {
        property: "og:description",
        content: "Sign in to your Dinequora restaurant operations workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

import { Button } from "@/components/ui/button";

function toPath(href: string | undefined) {
  if (!href) return null;
  try {
    const u = new URL(href, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const resend = async () => {
    setResending(true);
    setResent(false);
    setResendError(null);
    try {
      await auth.resendVerification(email.trim());
      setResent(true);
    } catch (err) {
      setResendError(err instanceof AuthError ? err.code : "unknown");
    } finally {
      setResending(false);
    }
  };

  // Explicit destinations win; otherwise platform administrators land in the Control Center.
  const next = async () => {
    const explicit = pendingRedirect.take() ?? toPath(redirect);
    if (explicit && explicit !== "/") return safeRedirect(explicit);
    return (await isPlatformAdmin()) ? "/control" : "/";
  };

  // Already signed in (returning from OAuth or the confirmation link): continue.
  useEffect(() => {
    const p = toPath(redirect);
    if (p) pendingRedirect.set(p);
    void auth.getUser().then((u) => {
      if (u) {
        sessionPersistence.set(true);
        void next().then((to) => navigate({ to, replace: true }));
      }
    });
    return auth.onChange((e) => {
      if (e === "signed_in") void next().then((to) => navigate({ to, replace: true }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!isEmail(email)) errs.email = t("errors.email");
    if (!password) errs.password = t("errors.required");
    setErrors(errs);
    setError(null);
    setResent(false);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      sessionPersistence.set(remember);
      await auth.signIn(email.trim(), password);
      void navigate({ to: await next(), replace: true });
    } catch (err) {
      setError(err instanceof AuthError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout back={redirect?.startsWith("/invite/") ? redirect : "/auth"}>
      <AuthHeading title={t("login.title")} subtitle={t("login.subtitle")} />
      <SocialButtons onError={setError} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && (
          <FormAlert>
            {t(`errors.${error}`)}
            {error === "email_not_verified" && (
              <Button
                type="button"
                variant="link"
                className="h-auto px-1"
                disabled={resending}
                onClick={() => void resend()}
              >
                {t("login.resend")}
              </Button>
            )}
          </FormAlert>
        )}
        {resendError && <FormAlert>{t(`errors.${resendError}`)}</FormAlert>}
        {resent && <FormAlert tone="success">{t("login.resent")}</FormAlert>}
        <Field
          id="email"
          type="email"
          autoComplete="email"
          label={t("fields.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <PasswordField
          id="password"
          autoComplete="current-password"
          label={t("fields.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          trailing={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("login.forgot")}
            </Link>
          }
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 rounded border accent-[var(--primary)]"
          />
          {t("fields.remember")}
        </label>
        <SubmitButton loading={loading}>{t("login.submit")}</SubmitButton>
      </form>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t("login.noAccount")}{" "}
        <Link
          to="/signup"
          search={redirect ? { redirect } : {}}
          className="font-medium text-foreground hover:underline"
        >
          {t("login.createAccount")}
        </Link>
      </p>
    </AuthLayout>
  );
}
