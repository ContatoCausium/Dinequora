import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2, ReceiptText, ShieldAlert } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { AppError, EmptyState } from "@/components/app/states";
import { fetchBilling } from "@/lib/org-service";
import { countBillableStores } from "@/lib/access-rules";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", orgDbId],
    queryFn: () => fetchBilling(orgDbId),
    enabled: role === "owner",
  });

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
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={<span className="eyebrow">{t("billing.eyebrow")}</span>}
        title={t("billing.title")}
        description={t("billing.subtitle", { org: org.name })}
      />

      <div className="surface mb-6 flex items-start gap-3 border-warning/40 bg-warning/10 p-4 text-sm">
        <CreditCard className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <p>{t("billing.notConnected")}</p>
      </div>

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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
                        : date(sub.current_period_end)
                    }
                  />
                </dl>
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
                      <span className="min-w-0 truncate">{e.description ?? e.kind}</span>
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
          <Panel title={t("billing.plans")} subtitle={t("billing.plansNote")}>
            <ul className="flex flex-col gap-2">
              {/* Smallest plan first. Prices are the placeholder per-location values stored in
                  billing_plans; the monthly figure below is derived from them, never invented. */}
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
                        {p.price_per_location_cents
                          ? t("billing.perLocation", {
                              price: fmtCurrency(p.price_per_location_cents / 100, lng),
                            })
                          : t("billing.custom")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("billing.planMeta", { count: p.default_store_limit, days: p.trial_days })}
                    </p>
                    {p.price_per_location_cents > 0 && (p.default_store_limit ?? 0) > 1 && (
                      <p className="tabular mt-0.5 text-xs text-muted-foreground">
                        {t("billing.planUpTo", {
                          count: p.default_store_limit,
                          total: fmtCurrency(
                            (p.price_per_location_cents * p.default_store_limit) / 100,
                            lng,
                          ),
                        })}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </Panel>
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
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        good && "bg-success/12 text-success",
        bad && "bg-destructive/12 text-destructive",
        !good && !bad && "bg-warning/15",
      )}
    >
      {t(`billing.statuses.${status}`, { defaultValue: status })}
    </span>
  );
}
