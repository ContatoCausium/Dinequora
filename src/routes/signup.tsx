import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
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
import { auth, AuthError, pendingRedirect, safeRedirect } from "@/lib/auth";

export const Route = createFileRoute("/signup")({
  validateSearch: z.object({ redirect: z.string().optional(), email: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Create account · Servora" },
      {
        name: "description",
        content: "Create your Servora account with Google, Microsoft or email.",
      },
      { property: "og:title", content: "Create account · Servora" },
      {
        property: "og:description",
        content: "Create your Servora account with Google, Microsoft or email.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { t, i18n } = useTranslation("auth");
  const search = Route.useSearch();
  const redirectPath = safeRedirect(search.redirect, "/auth");
  const backTo = search.redirect?.startsWith("/invite/")
    ? redirectPath
    : search.redirect
      ? `/auth?redirect=${encodeURIComponent(search.redirect)}`
      : "/auth";
  const [form, setForm] = useState({
    name: "",
    email: search.email ?? "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (form.name.trim().length < 2) errs.name = t("errors.required");
    if (!isEmail(form.email)) errs.email = t("errors.email");
    if (form.password.length < 8) errs.password = t("errors.passwordLength");
    if (form.confirm !== form.password) errs.confirm = t("errors.passwordMatch");
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      if (search.redirect) pendingRedirect.set(redirectPath);
      const r = await auth.signUp({
        email: form.email.trim(),
        password: form.password,
        fullName: form.name.trim(),
        language: i18n.language,
        redirectPath,
      });
      if (r.needsVerification) setSentTo(form.email.trim());
    } catch (err) {
      setError(err instanceof AuthError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout back={backTo}>
        <span className="mb-5 inline-flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title={t("signup.checkTitle")}
          subtitle={t("signup.checkBody", { email: sentTo })}
        />
        <Link to="/auth" className="text-sm font-medium text-primary hover:underline">
          {t("signup.backToLogin")}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout back={backTo}>
      <AuthHeading title={t("signup.title")} subtitle={t("signup.subtitle")} />
      <p className="-mt-3 mb-5 text-xs text-muted-foreground">{t("social.explainer")}</p>
      <SocialButtons onError={setError} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}
        <Field
          id="name"
          autoComplete="name"
          label={t("fields.fullName")}
          value={form.name}
          onChange={set("name")}
          error={errors.name}
        />
        <Field
          id="email"
          type="email"
          autoComplete="email"
          label={t("fields.email")}
          value={form.email}
          onChange={set("email")}
          error={errors.email}
        />
        <PasswordField
          id="password"
          autoComplete="new-password"
          label={t("fields.password")}
          value={form.password}
          onChange={set("password")}
          error={errors.password}
          hint={t("fields.passwordHint")}
        />
        <PasswordField
          id="confirm"
          autoComplete="new-password"
          label={t("fields.confirmPassword")}
          value={form.confirm}
          onChange={set("confirm")}
          error={errors.confirm}
        />
        <SubmitButton loading={loading}>{t("signup.submit")}</SubmitButton>
      </form>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t("signup.haveAccount")}{" "}
        <Link
          to="/auth"
          search={search.redirect ? { redirect: search.redirect } : {}}
          className="font-medium text-foreground hover:underline"
        >
          {t("signup.signIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
