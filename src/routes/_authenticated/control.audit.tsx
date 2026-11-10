import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, FileJson, History, Search, X } from "lucide-react";

import { LoadFailure } from "@/components/control/load-failure";
import { EmptyState } from "@/components/app/states";
import { inputCls, LoadingRows, Tag } from "@/components/control/control-ui";
import { useControlData } from "@/components/control/use-control-data";
import { fmtDate } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PlatformAudit } from "@/lib/admin-service";

export const Route = createFileRoute("/_authenticated/control/audit")({
  head: () => ({
    meta: [
      { title: "Audit log · Dinequora Control Center" },
      {
        name: "description",
        content: "Immutable record of sensitive changes across the Dinequora platform.",
      },
      { property: "og:title", content: "Audit log · Dinequora Control Center" },
      {
        property: "og:description",
        content: "Immutable record of sensitive changes across the Dinequora platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Audit,
});

const PAGE_SIZE = 25;

function Audit() {
  const { t, i18n } = useTranslation("control");
  const { data, error, loading, reload } = useControlData(500);
  const [org, setOrg] = useState("all");
  const [scope, setScope] = useState<"all" | "platform">("all");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [detailModal, setDetailModal] = useState<PlatformAudit | null>(null);

  const uniqueActions = useMemo(() => {
    const s = new Set<string>();
    (data?.audit ?? []).forEach((a) => s.add(a.action));
    return Array.from(s).sort();
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.audit ?? []).filter((a) => {
      if (org !== "all" && a.org_id !== org) return false;
      if (scope === "platform" && !a.action.startsWith("platform.")) return false;
      if (actionFilter !== "all" && a.action !== actionFilter) return false;
      if (q) {
        const matchAction = a.action.toLowerCase().includes(q);
        const matchTarget = (a.target ?? "").toLowerCase().includes(q);
        const matchOrg = (a.org_name ?? "").toLowerCase().includes(q);
        const metaStr = JSON.stringify(a.metadata ?? {}).toLowerCase();
        if (!matchAction && !matchTarget && !matchOrg && !metaStr.includes(q)) return false;
      }
      return true;
    });
  }, [data, org, scope, actionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.audit")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("auditPage.subtitle")}</p>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("auditPage.searchPlaceholder")}
            className={`${inputCls} pl-9`}
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <select
          aria-label={t("audit.org")}
          className={`${inputCls} max-w-[200px]`}
          value={org}
          onChange={(e) => {
            setOrg(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">{t("auditPage.allOrgs")}</option>
          {data?.orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("auditPage.actionFilter")}
          className={`${inputCls} max-w-[200px]`}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">{t("auditPage.allActions")}</option>
          {uniqueActions.map((act) => (
            <option key={act} value={act}>
              {t(`actions.${act}`, { defaultValue: act })}
            </option>
          ))}
        </select>
        <select
          aria-label={t("auditPage.scope")}
          className={`${inputCls} max-w-[160px]`}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as "all" | "platform");
            setPage(1);
          }}
        >
          <option value="all">{t("auditPage.allEvents")}</option>
          <option value="platform">{t("auditPage.platformOnly")}</option>
        </select>
      </div>
      {error && <LoadFailure kind={error} retry={() => void reload()} />}
      {loading ? (
        <LoadingRows />
      ) : !data ? null : rows.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title={t("audit.empty")} />
      ) : (
        <div className="surface min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr>
                {["when", "action", "org", "reason"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium">
                    {t(`audit.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {currentRows.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => setDetailModal(r)}
                >
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {fmtDate(r.created_at, i18n.language, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{t(`actions.${r.action}`, { defaultValue: r.action })}</span>
                      {r.action.startsWith("platform.") && <Tag tone="danger">Platform</Tag>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{r.org_name ?? t("audit.platform")}</td>
                  <td
                    className="max-w-[320px] truncate px-4 py-2.5 text-muted-foreground"
                    title={typeof r.metadata?.["reason"] === "string" ? r.metadata["reason"] : ""}
                  >
                    {typeof r.metadata?.["reason"] === "string"
                      ? r.metadata["reason"]
                      : typeof r.metadata?.["authorization_note"] === "string"
                        ? r.metadata["authorization_note"]
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <span>{t("orgsPage.pagination", { current: page, total: totalPages })}</span>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="h-8 px-2"
                >
                  <ChevronLeft className="size-4" />
                  {t("orgsPage.prev")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 px-2"
                >
                  {t("orgsPage.next")}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!detailModal} onOpenChange={(o) => !o && setDetailModal(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="size-5 text-primary" />
              {t("auditPage.detailTitle")}
            </DialogTitle>
            <DialogDescription>
              {detailModal?.created_at
                ? fmtDate(detailModal.created_at, i18n.language, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailModal && (
            <div className="grid gap-3 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded border bg-card p-3">
                <div>
                  <span className="font-medium text-muted-foreground">{t("audit.action")}:</span>
                  <p className="font-semibold text-foreground">
                    {t(`actions.${detailModal.action}`, { defaultValue: detailModal.action })}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">{t("audit.org")}:</span>
                  <p className="font-semibold text-foreground">
                    {detailModal.org_name ?? t("audit.platform")}
                  </p>
                </div>
                {detailModal.target && (
                  <div className="col-span-2">
                    <span className="font-medium text-muted-foreground">{t("audit.target")}:</span>
                    <p className="font-mono text-foreground">{detailModal.target}</p>
                  </div>
                )}
              </div>
              <div>
                <span className="font-medium text-muted-foreground">
                  {t("auditPage.metadataPayload")}:
                </span>
                <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/60 p-3 font-mono text-[11px] text-foreground">
                  {JSON.stringify(detailModal.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
