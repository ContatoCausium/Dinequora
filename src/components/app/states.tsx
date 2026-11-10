import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlert, PauseCircle, RotateCw } from "lucide-react";

import { captureError } from "@/lib/observability";
import { cn } from "@/lib/utils";

/** Quiet skeleton block — uses muted token, no shimmer gradients. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden />;
}

export function AppPending() {
  const { t } = useTranslation();
  return (
    <div
      className="mx-auto flex max-w-[1440px] flex-col gap-6 p-4 md:p-8"
      role="status"
      aria-label={t("states.loading")}
    >
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function StateCard({
  icon,
  title,
  body,
  action,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger" | "warning";
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <span
        className={cn(
          "mb-4 inline-flex size-11 items-center justify-center rounded-full border",
          tone === "danger"
            ? "border-destructive/25 text-destructive"
            : tone === "warning"
              ? "border-warning/30 text-warning"
              : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {body && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return <StateCard icon={icon} title={title} body={body} action={action} />;
}

export function AppError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  useEffect(() => {
    captureError(error, { event: "ui.route_error_boundary" });
  }, [error]);
  return (
    <StateCard
      tone="danger"
      icon={<CircleAlert className="size-5" strokeWidth={1.75} />}
      title={t("states.errorTitle")}
      body={t("states.errorBody")}
      action={
        <button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3.5 text-sm font-medium shadow-xs hover:bg-muted"
        >
          <RotateCw className="size-3.5" />
          {t("states.retry")}
        </button>
      }
    />
  );
}

export function SuspendedState({ reason }: { reason: string | null }) {
  const { t } = useTranslation();
  return (
    <StateCard
      tone="warning"
      icon={<PauseCircle className="size-5" strokeWidth={1.75} />}
      title={t("states.suspendedTitle")}
      body={
        <>
          {t("states.suspendedBody")}
          {reason ? (
            <span className="mt-2 block text-xs">{t("states.reason", { reason })}</span>
          ) : null}
        </>
      }
    />
  );
}

/** Shown when the browser cap stopped reading the order history (fetchAllOrders `truncated`). */
export function OrdersTruncatedNotice({
  shown,
  total,
  truncated,
}: {
  shown: number;
  total: number;
  truncated: boolean;
}) {
  const { t } = useTranslation();
  if (!truncated || shown >= total) return null;
  return (
    <div
      role="status"
      className="surface flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground"
    >
      <CircleAlert className="size-4 shrink-0 text-warning" />
      <span>{t("states.ordersTruncated", { shown, total })}</span>
    </div>
  );
}
