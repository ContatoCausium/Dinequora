import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  AuthHeading,
  AuthLayout,
  FormAlert,
  PasswordField,
  SubmitButton,
} from "@/components/auth/auth-layout";
import { auth, AuthError } from "@/lib/auth";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password · Servora" },
      { name: "description", content: "Set a new password for your Servora account." },
      { property: "og:title", content: "Choose a new password · Servora" },
      { property: "og:description", content: "Set a new password for your Servora account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const { t } = useTranslation("auth");
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [pw, setPw] = useState({ a: "", b: "" });
  const [errs, setErrs] = useState<{ a?: string; b?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The recovery link signs the user in with a short-lived session; wait for it.
  useEffect(() => {
    const isRecovery =
      window.location.search.includes("recovery=1") ||
      window.location.hash.includes("type=recovery");
    const off = auth.onChange((e) => {
      if (e === "password_recovery" || (e === "signed_in" && isRecovery)) setState("ready");
    });
    const timer = window.setTimeout(async () => {
      const u = await auth.getUser();
      setState((s) => (s === "checking" ? (u && isRecovery ? "ready" : "invalid") : s));
    }, 900);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: typeof errs = {};
    if (pw.a.length < 8) x.a = t("errors.passwordLength");
    if (pw.b !== pw.a) x.b = t("errors.passwordMatch");
    setErrs(x);
    setError(null);
    if (Object.keys(x).length) return;
    setLoading(true);
    try {
      await auth.updatePassword(pw.a);
      setState("done");
    } catch (err) {
      setError(err instanceof AuthError ? err.code : "unknown");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      {state === "checking" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("reset.checking")}
        </p>
      )}
      {state === "invalid" && (
        <>
          <AuthHeading title={t("reset.invalidTitle")} subtitle={t("reset.invalidBody")} />
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t("reset.requestNew")}
          </Link>
        </>
      )}
      {state === "done" && (
        <>
          <span className="mb-5 inline-flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-5" />
          </span>
          <AuthHeading title={t("reset.doneTitle")} subtitle={t("reset.doneBody")} />
          <Link
            to="/"
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("reset.continue")}
          </Link>
        </>
      )}
      {state === "ready" && (
        <>
          <AuthHeading title={t("reset.title")} subtitle={t("reset.subtitle")} />
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}
            <PasswordField
              id="new"
              autoComplete="new-password"
              label={t("fields.newPassword")}
              value={pw.a}
              onChange={(e) => setPw((p) => ({ ...p, a: e.target.value }))}
              error={errs.a}
              hint={t("fields.passwordHint")}
            />
            <PasswordField
              id="confirm"
              autoComplete="new-password"
              label={t("fields.confirmPassword")}
              value={pw.b}
              onChange={(e) => setPw((p) => ({ ...p, b: e.target.value }))}
              error={errs.b}
            />
            <SubmitButton loading={loading}>{t("reset.submit")}</SubmitButton>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
