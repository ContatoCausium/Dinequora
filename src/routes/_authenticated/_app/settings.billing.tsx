import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  CreditCard,
  ExternalLink,
  FlaskConical,
  Info,
  Loader2,
  ReceiptText,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { AppError, EmptyState } from "@/components/app/states";
import { fetchBilling } from "@/lib/org-service";
import { countBillableStores } from "@/lib/access-rules";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isClientPreview } from "@/lib/deployment-profile";
import { getBillingMode, openBillingPortal, startCheckout } from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/_app/settings/billing")({
  head: () => ({
    meta: [
      { title: "Billing · Dinequora" },
      {
        name: "description",
        content: "Subscription plan, trial, billed locations and billing history.",
      },
      { property: "og:title", content: "Billing · Dinequora" },
      {
        property: "og:description",
        content: "Subscription plan, trial, billed locations and billing history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const { t, i18n } = useTranslation("settings");
  const lng = i18n.language;
  const { role, orgDbId, org, storeLimit } = useWorkspace();
  // Client preview: billing is arranged directly with Dinequora, so no placeholder price list or
  // "payments not connected" warning is shown — only the subscription the workspace actually has.
  const preview = isClientPreview();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", orgDbId],
    queryFn: () => fetchBilling(orgDbId),
    enabled: role === "owner",
  });
  // Whether the server can open Stripe Checkout (STRIPE_* secrets); never in the client preview.
  const modeQuery = useQuery({
    queryKey: ["billing-mode"],
    queryFn: () => getBillingMode(),
    enabled: role === "owner" && !preview,
    staleTime: 5 * 60_000,
  });
  const mode = preview ? "off" : (modeQuery.data?.mode ?? "off");
  const [busy, setBusy] = useState<string | null>(null);
  // Back from Stripe Checkout: the browser never reports success; the signed webhook updates the
  // subscription a few seconds later, so the page refetches instead of trusting the return URL.
  const [returned, setReturned] = useState<"success" | "canceled" | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("checkout");
    if (value !== "success" && value !== "canceled") return;
    setReturned(value);
    window.history.replaceState(null, "", window.location.pathname);
    if (value !== "success") return;
    const timers = [3000, 8000, 15000].map((ms) => window.setTimeout(() => void refetch(), ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [refetch]);

  const go = async (key: string, run: () => Promise<{ status: string; url?: string }>) => {
    setBusy(key);
    try {
      const r = await run();
      if (r.status === "redirect" && r.url) {
        window.location.assign(r.url);
        return;
      }
      toast.error(
        t(`billing.checkoutErrors.${r.status}`, {
          defaultValue: t("billing.checkoutErrors.unavailable"),
        }),
      );
    } catch {
      toast.error(t("billing.checkoutErrors.unavailable"));
    }
    setBusy(null);
  };
  const subscribe = (planId: string) =>
    go(`plan:${planId}`, () => startCheckout({ data: { orgId: orgDbId, planId } }));
  const manage = () => go("portal", () => openBillingPortal({ data: { orgId: orgDbId } }));

  if (role !== "owner") {
    return (
      <div className="mx-auto max-w-[900px]">
        <EmptyState
          icon={<ShieldAlert className="size-5" strokeWidth={1.75} />}
          title={t("billing.ownerOnlyTitle")}
          body={t("billing.ownerOnlyBody")}
        />
      </div>
    );
  }
  if (error) return <AppError error={error as Error} reset={() => void refetch()} />;

  const activeStores = countBillableStores(org.locations.map((l) => l.lifecycle ?? "active"));
  const sub = data?.subscription;
  const plan = data?.plans.find((p) => p.id === sub?.plan_id);
  const date = (d: string | null) =>
    d ? fmtDate(d, lng, { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    // Same container as every other app page, so the title never shifts when switching screens.
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={<span className="eyebrow">{t("billing.eyebrow")}</span>}
        title={t("billing.title")}
        description={t("billing.subtitle", { org: org.name })}
      />

      {returned && (
        <div
          role="status"
          className={cn(
            "surface mb-6 flex items-start gap-3 p-4 text-sm",
            returned === "success" ? "border-success/40 bg-success/10" : "text-muted-foreground",
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p>
            {t(returned === "success" ? "billing.checkoutReturned" : "billing.checkoutCanceled")}
          </p>
        </div>
      )}
      {preview ? (
        <div className="surface mb-6 flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p>{t("billing.previewManaged")}</p>
        </div>
      ) : mode === "test" ? (
        <div className="surface mb-6 flex items-start gap-3 border-info/40 bg-info/10 p-4 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p>{t("billing.testMode")}</p>
        </div>
      ) : mode === "live" ? null : (
        <div className="surface mb-6 flex items-start gap-3 border-warning/40 bg-warning/10 p-4 text-sm">
          <CreditCard className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <p>{t("billing.notConnected")}</p>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <div className={cn("grid gap-6", !preview && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title={t("billing.subscription")}>
              {!sub ? (
                <p className="text-sm text-muted-foreground">{t("billing.noSubscription")}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
                  <Item label={t("billing.plan")} value={plan?.name ?? sub.plan_id} />
                  <Item label={t("billing.status")} value={<StatusPill status={sub.status} />} />
                  {/* Stores in use come from the stores themselves (same count as the Stores page);
                      the billed quantity is what the billing provider last synced, shown separately. */}
                  <Item
                    label={t("billing.activeLocations")}
                    value={`${activeStores} / ${storeLimit}`}
                  />
                  <Item
                    label={t("billing.billedLocations")}
                    value={
                      sub.billed_locations === activeStores
                        ? String(sub.billed_locations)
                        : t("billing.billedPendingSync", { count: sub.billed_locations })
                    }
                  />
                  {sub.status === "trialing" && (
                    <Item label={t("billing.trialEnds")} value={date(sub.trial_ends_at)} />
                  )}
                  {sub.status === "grace" && (
                    <Item label={t("billing.graceEnds")} value={date(sub.grace_ends_at)} />
                  )}
                  <Item
                    label={t("billing.renews")}
                    value={
                      sub.cancel_at_period_end
                        ? t("billing.cancelsAtEnd")
                        : preview && !sub.current_period_end
                          ? t("billing.renewsManaged")
                          : date(sub.current_period_end)
                    }
                  />
                </dl>
              )}
              {mode !== "off" && sub?.stripe_subscription_id && (
                <div className="mt-5 border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void manage()}
                  >
                    {busy === "portal" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-4" />
                    )}
                    {t("billing.manage")}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">{t("billing.manageNote")}</p>
                </div>
              )}
            </Panel>
            <Panel title={t("billing.history")} bodyClassName="p-0">
              {!data?.events.length ? (
                <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
                  <ReceiptText className="size-4" strokeWidth={1.75} />
                  {t("billing.noHistory")}
                </div>
              ) : (
                <ul className="divide-y">
                  {data.events.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {t(`billing.eventKinds.${e.kind}`, {
                          defaultValue: e.description ?? e.kind,
                        })}
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        {date(e.occurred_at)}
                      </span>
                      <span className="tabular font-medium">
                        {e.amount_cents != null ? fmtCurrency(e.amount_cents / 100, lng) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          {!preview && (
            <Panel title={t("billing.plans")} subtitle={t("billing.plansNote")}>
              <ul className="flex flex-col gap-2">
                {/* Smallest plan first. Prices come from billing_plans (0047: the website's prices,
                  a flat monthly subscription plus a one-time implementation fee). */}
                {[...(data?.plans ?? [])]
                  .sort(
                    (a, b) =>
                      (a.default_store_limit ?? 0) - (b.default_store_limit ?? 0) ||
                      a.name.localeCompare(b.name),
                  )
                  .map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "rounded-lg border p-3.5",
                        p.id === sub?.plan_id && "border-primary/50 bg-primary-soft/40",
                      )}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold">{p.name}</span>
                        <span className="tabular text-sm">
                          {p.monthly_price_cents != null
                            ? t("billing.perMonth", {
                                price: fmtCurrency(p.monthly_price_cents / 100, lng),
                              })
                            : t("billing.custom")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("billing.planMeta", {
                          count: p.default_store_limit,
                          days: p.trial_days,
                        })}
                      </p>
                      {p.implementation_fee_cents > 0 && (
                        <p className="tabular mt-0.5 text-xs text-muted-foreground">
                          {t(
                            p.implementation_fee_is_minimum
                              ? "billing.implementationFrom"
                              : "billing.implementation",
                            { price: fmtCurrency(p.implementation_fee_cents / 100, lng) },
                          )}
                        </p>
                      )}
                      {mode !== "off" &&
                        p.monthly_price_cents != null &&
                        !p.implementation_fee_is_minimum &&
                        !(sub?.stripe_subscription_id && sub.status !== "canceled") && (
                          <Button
                            className="mt-3 w-full"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void subscribe(p.id)}
                          >
                            {busy === `plan:${p.id}` && <Loader2 className="size-4 animate-spin" />}
                            {t("billing.subscribe", { plan: p.name })}
                          </Button>
                        )}
                    </li>
                  ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation("settings");
  const good = status === "active" || status === "trialing";
  const bad = status === "unpaid" || status === "canceled" || status === "past_due";
  return (
    <Badge variant={good ? "success" : bad ? "danger" : "warning"}>
      {good ? (
        <CheckCircle2 aria-hidden />
      ) : bad ? (
        <CircleAlert aria-hidden />
      ) : (
        <Clock aria-hidden />
      )}
      {t(`billing.statuses.${status}`, { defaultValue: status })}
    </Badge>
  );
}
