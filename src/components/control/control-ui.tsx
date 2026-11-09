import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assignOwner, updateOrganization, type PlanId } from "@/lib/admin-service";
import type { OrgStatus } from "@/lib/org-service";
import { cn } from "@/lib/utils";

export const STATUS: OrgStatus[] = ["trial", "active", "suspended"];
export const PLANS: PlanId[] = ["starter", "growth", "enterprise"];
export const inputCls =
  "h-9 min-w-0 w-full rounded-md border bg-card px-3 text-sm shadow-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/15";
export const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
export const btnGhost =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted";
export const btnOutline =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium shadow-xs hover:bg-muted";

type OrgRef = { id: string; name: string; status: OrgStatus; plan: string; store_limit: number };

export function useErr() {
  const { t } = useTranslation("control");
  return (e: unknown) =>
    t(`errors.${e instanceof Error ? e.message : "unknown"}`, {
      defaultValue: t("errors.unknown"),
    });
}

export function StatusPill({ status }: { status: OrgStatus }) {
  const { t } = useTranslation("control");
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "active" ? "bg-success" : status === "trial" ? "bg-warning" : "bg-destructive",
        )}
      />
      {t(`status.${status}`)}
    </span>
  );
}

export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 text-[10px] font-medium leading-4",
        tone === "warning"
          ? "border-warning/40 text-warning"
          : tone === "danger"
            ? "border-destructive/40 text-destructive"
            : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section card used across the Control Center. */
export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface min-w-0", className)}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: "muted" | undefined;
}) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em]",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Shell({
  title,
  description,
  children,
  footer,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditOrgDialog({
  org,
  onClose,
  onSaved,
}: {
  org: OrgRef;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation("control");
  const errText = useErr();
  const [plan, setPlan] = useState(org.plan as PlanId);
  const [limit, setLimit] = useState(String(org.store_limit));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validReason = reason.trim().length >= 3;
  const save = async () => {
    if (!validReason) {
      setError(t("errors.reason_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const n = Math.max(1, Math.min(500, Math.round(Number(limit) || org.store_limit)));
      await updateOrganization(
        org.id,
        {
          ...(plan !== org.plan ? { plan } : {}),
          ...(n !== org.store_limit ? { storeLimit: n } : {}),
        },
        reason.trim(),
      );
      toast.success(t("saved"));
      await onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title={t("edit.title", { name: org.name })}
      description={t("edit.description")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("edit.cancel")}
          </button>
          <button onClick={save} disabled={busy || !validReason} className={btnPrimary}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("edit.save")}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          {t("orgs.plan")}
          <select
            className={inputCls}
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanId)}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {t(`plans.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {t("edit.storeLimit")}
          <input
            className={inputCls}
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("edit.limitHint")}</p>
      <label className="grid gap-1.5 text-sm font-medium">
        {t("edit.reason")} *
        <textarea
          required
          className={cn(inputCls, "h-20 py-2")}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t("edit.reasonPlaceholder")}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function StatusDialog({
  org,
  onClose,
  onSaved,
}: {
  org: OrgRef;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation("control");
  const errText = useErr();
  const suspending = org.status !== "suspended";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validReason = reason.trim().length >= 3;
  const save = async () => {
    if (!validReason) {
      setError(t("errors.reason_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateOrganization(
        org.id,
        { status: suspending ? "suspended" : "active" },
        reason.trim(),
      );
      toast.success(t("saved"));
      await onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title={t(suspending ? "suspend.title" : "suspend.reactivateTitle", { name: org.name })}
      description={t(suspending ? "suspend.description" : "suspend.reactivateDescription")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("edit.cancel")}
          </button>
          <button
            onClick={save}
            disabled={busy || !validReason}
            className={cn(btnPrimary, suspending && "bg-destructive hover:bg-destructive/90")}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t(suspending ? "suspend.confirm" : "suspend.reactivate")}
          </button>
        </>
      }
    >
      <label className="grid gap-1.5 text-sm font-medium">
        {t("edit.reason")} *
        <textarea
          required
          className={cn(inputCls, "h-20 py-2")}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t("edit.reasonPlaceholder")}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function AssignOwnerDialog({
  org,
  onClose,
  onSaved,
}: {
  org: OrgRef;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation("control");
  const errText = useErr();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await assignOwner(org.id, email.trim(), note.trim());
      toast.success(t("saved"));
      await onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title={t("assign.title", { name: org.name })}
      description={t("assign.description")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            {t("edit.cancel")}
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("assign.confirm")}
          </button>
        </>
      }
    >
      <label className="grid gap-1.5 text-sm font-medium">
        {t("assign.email")}
        <input
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        {t("assign.note")}
        <textarea
          className={cn(inputCls, "h-24 py-2")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("assign.notePlaceholder")}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="surface min-w-0 divide-y" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.4fr)_minmax(0,0.6fr)] items-center gap-4 px-5 py-4"
        >
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="ml-auto h-3 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
