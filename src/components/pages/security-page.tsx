import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Smartphone } from "lucide-react";

import { PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth, AuthError, type MfaEnrollment, type MfaFactor } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

/**
 * Settings > Security: two-step verification with an authenticator app (TOTP). Every member manages
 * their own; once an authenticator is confirmed, each new sign-in asks for its code (/mfa).
 */
export function SecurityPage() {
  const { t, i18n } = useTranslation("settings");
  const qc = useQueryClient();
  const factors = useQuery({ queryKey: ["mfa-factors"], queryFn: () => auth.mfa.listFactors() });
  const [enrolling, setEnrolling] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MfaFactor | null>(null);
  const verified = (factors.data ?? []).filter((f) => f.verified);
  const errorText = (e: unknown) =>
    e instanceof AuthError && e.code === "invalid_code"
      ? t("security.errors.invalid")
      : e instanceof AuthError && e.code === "mfa_required"
        ? t("security.errors.reauth")
        : t("security.errors.unknown");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setEnrolling(await auth.mfa.enroll(t("security.appName")));
      setCode("");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!enrolling) return;
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) return setError(t("security.errors.format"));
    setBusy(true);
    setError(null);
    try {
      await auth.mfa.confirmEnrollment(enrolling.factorId, digits);
      toast.success(t("security.enabled"));
      setEnrolling(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["mfa-factors"] });
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await auth.mfa.remove(removing.id);
      toast.success(t("security.removed"));
      setRemoving(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["mfa-factors"] });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("security.title")} description={t("security.description")} />
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            {verified.length ? (
              <ShieldCheck className="size-4 text-success" aria-hidden />
            ) : (
              <ShieldOff className="size-4 text-muted-foreground" aria-hidden />
            )}
            {t("security.mfaTitle")}
          </span>
        }
        subtitle={verified.length ? t("security.statusOn") : t("security.statusOff")}
      >
        <p className="mb-4 text-sm text-muted-foreground">{t("security.mfaBody")}</p>
        {verified.length > 0 && (
          <ul className="mb-4 space-y-2">
            {verified.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <Smartphone className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  {f.name ?? t("security.appName")}
                  <span className="ml-2 text-muted-foreground">
                    {t("security.since", { date: fmtDate(f.createdAt, i18n.language) })}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => setRemoving(f)}>
                  {t("security.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {verified.length === 0 && (
          <Button onClick={() => void start()} disabled={busy || factors.isPending}>
            {t("security.enable")}
          </Button>
        )}
      </Panel>

      <Dialog open={enrolling !== null} onOpenChange={(o) => !o && !busy && setEnrolling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("security.setupTitle")}</DialogTitle>
            <DialogDescription>{t("security.setupBody")}</DialogDescription>
          </DialogHeader>
          {enrolling && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              <img
                src={enrolling.qrCode}
                alt={t("security.qrAlt")}
                className="mx-auto size-44 rounded-md border bg-white p-2"
              />
              <p className="text-center text-[13px] text-muted-foreground">
                {t("security.secretHint")}
                <code className="mt-1 block select-all break-all font-mono text-foreground">
                  {enrolling.secret}
                </code>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-setup-code">{t("security.code")}</Label>
                <Input
                  id="mfa-setup-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-invalid={error !== null}
                  aria-describedby={error ? "mfa-setup-error" : undefined}
                  autoFocus
                />
              </div>
              {error && (
                <p id="mfa-setup-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEnrolling(null)}
                >
                  {t("security.cancel")}
                </Button>
                <Button type="submit" disabled={busy}>
                  {t("security.confirm")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && !busy && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("security.removeTitle")}</DialogTitle>
            <DialogDescription>{t("security.removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
              {t("security.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {t("security.removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
