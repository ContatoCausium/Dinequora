import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Building2, Check, Circle, Search, UserRoundCheck } from "lucide-react";

import { DemoBadge } from "@/components/app/brand-mark";
import { LoadFailure } from "@/components/control/load-failure";
import { EmptyState } from "@/components/app/states";
import {
  AssignOwnerDialog,
  btnOutline,
  EditOrgDialog,
  inputCls,
  LoadingRows,
  PLANS,
  STATUS,
  StatusDialog,
  StatusPill,
  Tag,
} from "@/components/control/control-ui";
import { useControlData } from "@/components/control/use-control-data";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OrgInsight } from "@/lib/admin-service";
import { attentionReasons, onboardingSteps } from "@/lib/platform-metrics";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const search = z.object({
  org: z.string().optional(),
  plan: z.enum(["all", "starter", "growth", "enterprise"]).optional(),
  status: z.enum(["all", "trial", "active", "suspended"]).optional(),
  kind: z.enum(["all", "customer", "demo"]).optional(),
});

export const Route = createFileRoute("/_authenticated/control/organizations")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Organizations · Dinequora Control Center" },
      {
        name: "description",
        content: "Review organizations, ownership, trials, location usage and onboarding progress.",
      },
      { property: "og:title", content: "Organizations · Dinequora Control Center" },
      {
        property: "og:description",
        content: "Review organizations, ownership, trials, location usage and onboarding progress.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Organizations,
});

type Dialog = { kind: "limits" | "status" | "owner"; org: OrgInsight } | null;

function Organizations() {
  const { t, i18n } = useTranslation("control");
  const lng = i18n.language;
  const s = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, error, loading, reload } = useControlData(200);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const set = (patch: Partial<z.infer<typeof search>>) =>
    void navigate({ search: (p) => ({ ...p, ...patch }), replace: true });

  const [page, setPage] = useState(1);
  const pageSize = 15;

  const rows = useMemo(
    () =>
      (data?.orgs ?? []).filter(
        (o) =>
          (!s.plan || s.plan === "all" || o.plan === s.plan) &&
          (!s.status || s.status === "all" || o.status === s.status) &&
          (!s.kind || s.kind === "all" || (s.kind === "demo") === o.is_demo) &&
          (!q ||
            o.name.toLowerCase().includes(q.toLowerCase()) ||
            (o.owner_email ?? "").toLowerCase().includes(q.toLowerCase())),
      ),
    [data, s, q],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginatedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page],
  );
  const selected = data?.orgs.find((o) => o.id === s.org) ?? null;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.orgs")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("orgsPage.subtitle")}</p>
      </header>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,160px))]">
        <label className="relative">
          <span className="sr-only">{t("orgsPage.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputCls, "pl-9")}
            placeholder={t("orgsPage.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          aria-label={t("orgs.plan")}
          className={inputCls}
          value={s.plan ?? "all"}
          onChange={(e) => set({ plan: e.target.value as never })}
        >
          <option value="all">{t("orgsPage.allPlans")}</option>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {t(`plans.${p}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("orgs.status")}
          className={inputCls}
          value={s.status ?? "all"}
          onChange={(e) => set({ status: e.target.value as never })}
        >
          <option value="all">{t("orgsPage.allStatus")}</option>
          {STATUS.map((x) => (
            <option key={x} value={x}>
              {t(`status.${x}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("orgsPage.kind")}
          className={inputCls}
          value={s.kind ?? "all"}
          onChange={(e) => set({ kind: e.target.value as never })}
        >
          <option value="all">{t("orgsPage.allKinds")}</option>
          <option value="customer">{t("orgsPage.customers")}</option>
          <option value="demo">{t("orgsPage.demos")}</option>
        </select>
      </div>

      {error && <LoadFailure kind={error} retry={() => void reload()} />}
      {loading ? (
        <LoadingRows />
      ) : !data ? null : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title={data.orgs.length ? t("orgsPage.noMatch") : t("orgs.empty")}
        />
      ) : (
        <div className="surface min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[820px] whitespace-nowrap text-sm">
            <thead className="border-b text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr>
                {["name", "status", "plan", "stores", "owner", "trial", "created"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium">
                    {t(`orgs.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {paginatedRows.map((o) => {
                const pct = Math.min(
                  100,
                  (o.active_store_count / Math.max(o.store_limit, 1)) * 100,
                );
                return (
                  <tr
                    key={o.id}
                    onClick={() => set({ org: o.id })}
                    className="cursor-pointer hover:bg-muted/40"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        className="font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          set({ org: o.id });
                        }}
                      >
                        {o.name}
                      </button>
                      <span className="ml-2 inline-flex gap-1.5 align-middle">
                        {o.is_demo && <DemoBadge label={t("orgs.demo")} />}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={o.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      {t(`plans.${o.plan}`, { defaultValue: o.plan })}
                      {o.has_override && (
                        <span className="ml-1.5">
                          <Tag>{t("orgsPage.override")}</Tag>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="tabular w-10">
                          {o.active_store_count}/{o.store_limit}
                        </span>
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn("block h-full", pct >= 100 ? "bg-warning" : "bg-primary")}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-muted-foreground">
                      {o.owner_email ?? (
                        <Tag tone={o.is_demo ? "neutral" : "warning"}>{t("orgs.noOwner")}</Tag>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {o.sub_status === "trialing" && o.trial_ends_at
                        ? t("orgsPage.trialEnds", { date: fmtDate(o.trial_ends_at, lng) })
                        : t(`sub.${o.sub_status ?? "none"}`, { defaultValue: o.sub_status ?? "—" })}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fmtDate(o.created_at, lng)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                {t("orgsPage.pagination", {
                  current: page,
                  total: totalPages,
                  defaultValue: `Page ${page} of ${totalPages}`,
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={cn(btnOutline, "h-7 px-2 text-xs disabled:opacity-40")}
                >
                  {t("orgsPage.prev", { defaultValue: "Previous" })}
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={cn(btnOutline, "h-7 px-2 text-xs disabled:opacity-40")}
                >
                  {t("orgsPage.next", { defaultValue: "Next" })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && set({ org: undefined })}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && data && (
            <OrgDetail
              org={selected}
              audit={data.audit.filter((a) => a.org_id === selected.id)}
              onAction={(kind) => setDialog({ kind, org: selected })}
            />
          )}
        </SheetContent>
      </Sheet>

      {dialog?.kind === "limits" && (
        <EditOrgDialog org={dialog.org} onClose={() => setDialog(null)} onSaved={reload} />
      )}
      {dialog?.kind === "status" && (
        <StatusDialog org={dialog.org} onClose={() => setDialog(null)} onSaved={reload} />
      )}
      {dialog?.kind === "owner" && (
        <AssignOwnerDialog org={dialog.org} onClose={() => setDialog(null)} onSaved={reload} />
      )}
    </>
  );
}

function OrgDetail({
  org,
  audit,
  onAction,
}: {
  org: OrgInsight;
  audit: { id: string; action: string; created_at: string; target: string | null }[];
  onAction: (k: "limits" | "status" | "owner") => void;
}) {
  const { t, i18n } = useTranslation("control");
  const lng = i18n.language;
  const steps = onboardingSteps(org);
  const done = steps.filter((x) => x.done).length;
  const reasons = attentionReasons(org, Date.now());
  return (
    <>
      <SheetHeader className="text-left">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={org.status} />
          {org.is_demo && <DemoBadge label={t("orgs.demo")} />}
        </div>
        <SheetTitle className="text-xl">{org.name}</SheetTitle>
        <SheetDescription>
          {t("detail.created", {
            date: fmtDate(org.created_at, lng, { year: "numeric", month: "short", day: "numeric" }),
          })}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-2 grid gap-5 px-4 pb-6">
        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <Tag key={r} tone="warning">
                {t(`attention.${r}`)}
              </Tag>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button className={btnOutline} onClick={() => onAction("limits")}>
            {t("detail.changeLimits")}
          </button>
          <button className={btnOutline} onClick={() => onAction("status")}>
            {org.status === "suspended" ? t("suspend.reactivate") : t("suspend.confirm")}
          </button>
          {org.owner_count === 0 && (
            <button className={btnOutline} onClick={() => onAction("owner")}>
              <UserRoundCheck className="size-3.5" />
              {t("orgs.assignOwner")}
            </button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4 text-sm">
          <Item label={t("orgs.plan")} value={t(`plans.${org.plan}`, { defaultValue: org.plan })} />
          <Item
            label={t("detail.subscription")}
            value={t(`sub.${org.sub_status ?? "none"}`, { defaultValue: org.sub_status ?? "—" })}
          />
          <Item
            label={t("detail.stores")}
            value={t("detail.storesValue", {
              active: org.active_store_count,
              total: org.store_count,
              limit: org.store_limit,
            })}
          />
          <Item
            label={t("detail.trialEnds")}
            value={
              org.trial_ends_at
                ? fmtDate(org.trial_ends_at, lng, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "—"
            }
          />
          <Item label={t("detail.owner")} value={org.owner_email ?? t("orgs.noOwner")} />
          <Item
            label={t("detail.members")}
            value={t("detail.membersValue", {
              members: org.member_count,
              invites: org.pending_invites,
            })}
          />
          <Item
            label={t("detail.billing")}
            value={org.billing_connected ? t("detail.billingOn") : t("detail.billingOff")}
          />
          <Item
            label={t("detail.lastActivity")}
            value={org.last_activity ? fmtDate(org.last_activity, lng) : "—"}
          />
        </dl>

        <div>
          <p className="mb-2 flex items-baseline justify-between text-sm font-semibold">
            {t("detail.onboarding")}
            <span className="tabular text-xs font-normal text-muted-foreground">
              {done}/{steps.length}
            </span>
          </p>
          <ul className="grid gap-1.5">
            {steps.map((x) => (
              <li
                key={x.key}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  !x.done && "text-muted-foreground",
                )}
              >
                {x.done ? (
                  <Check className="size-4 text-success" />
                ) : (
                  <Circle className="size-4" strokeWidth={1.5} />
                )}
                {t(`steps.${x.key}`)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">{t("detail.audit")}</p>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
          ) : (
            <ol className="divide-y rounded-lg border">
              {audit.slice(0, 15).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="truncate">
                    {t(`actions.${a.action}`, { defaultValue: a.action })}
                  </span>
                  <time className="tabular shrink-0 text-xs text-muted-foreground">
                    {fmtDate(a.created_at, lng, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("detail.privacy")}</p>
      </div>
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
