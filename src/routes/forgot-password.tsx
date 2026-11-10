import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, MailCheck } from "lucide-react";

import {
  AuthHeading,
  AuthLayout,
  Field,
  FormAlert,
  isEmail,
  SubmitButton,
} from "@/components/auth/auth-layout";
import { auth, AuthError } from "@/lib/auth";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password · Dinequora" },
      { name: "description", content: "Request a secure link to reset your Dinequora password." },
      { property: "og:title", content: "Reset password · Dinequora" },
      {
        property: "og:description",
        content: "Request a secure link to reset your Dinequora password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [fieldErr, setFieldErr] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setFieldErr(t("errors.email"));
    setFieldErr(undefined);
    setError(null);
    setLoading(true);
    try {
      await auth.sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      // Don't reveal whether the account exists; only surface rate limits.
      if (err instanceof AuthError && err.code === "rate_limited") setError("rate_limited");
      else setSent(true);
    } finally {
      setLoading(false);
    }
  };

  const back = (
    <Link
      to="/auth"
      className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("forgot.back")}
    </Link>
  );

  if (sent)
    return (
      <AuthLayout>
        <span className="mb-5 inline-flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title={t("forgot.sentTitle")}
          subtitle={t("forgot.sentBody", { email: email.trim() })}
        />
        {back}
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <AuthHeading title={t("forgot.title")} subtitle={t("forgot.subtitle")} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}
        <Field
          id="email"
          type="email"
          autoComplete="email"
          label={t("fields.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErr}
        />
        <SubmitButton loading={loading}>{t("forgot.submit")}</SubmitButton>
      </form>
      {back}
    </AuthLayout>
  );
}
