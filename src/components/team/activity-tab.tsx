import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCw } from "lucide-react";

import { Panel } from "@/components/app/page";
import { EmptyState, Skeleton, StateCard } from "@/components/app/states";
import { useWorkspace } from "@/components/app/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchOrgAudit, type AuditEntry } from "@/lib/org-service";
import { isPermission } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import {
  UUID_RE,
  humanizeAction,
  isKnownAuditAction,
  targetIsReadable,
  targetIsUser,
} from "./access-model";
import { usePermissionLabels } from "./team-hooks";
import { auditQueryKey, type TeamMember } from "./team-types";

const ALL = "__all";
const FIRST_PAGE = 50;
const MAX_PAGE = 200;

export function ActivityTab({ members }: { members: TeamMember[] }) {
  const { t, i18n } = useTranslation("team");
  const { orgDbId, org } = useWorkspace();
  const { permLabel } = usePermissionLabels();
  const [actorId, setActorId] = useState(ALL);
  const [locationId, setLocationId] = useState(ALL);
  const [result, setResult] = useState<AuditEntry["result"] | typeof ALL>(ALL);
  const [limit, setLimit] = useState(FIRST_PAGE);

  const filters = {
    actorId: actorId === ALL ? undefined : actorId,
    locationDbId: locationId === ALL ? undefined : locationId,
    result: result === ALL ? undefined : result,
  };
  const q = useQuery({
    queryKey: [...auditQueryKey(orgDbId), filters, limit],
    queryFn: () => fetchOrgAudit(orgDbId, limit, filters),
    placeholderData: (prev) => prev,
  });

  const nameOf = (userId: string | null) => {
    if (!userId) return t("activity.system");
    const m = members.find((x) => x.user_id === userId);
    if (!m) return t("activity.unknownMember");
    return m.full_name ?? t("page.unnamed");
  };
  const storeOf = (id: string | null) => {
    if (!id) return "—";
    return org.locations.find((l) => l.dbId === id)?.name ?? t("activity.otherStore");
  };
  const actionOf = (a: string) =>
    isKnownAuditAction(a) ? t(`activity.actions.${a}`) : humanizeAction(a);
  const detailOf = (e: AuditEntry) => {
    if (!e.target) return null;
    if (targetIsUser(e.action)) return UUID_RE.test(e.target) ? nameOf(e.target) : null;
    if (isPermission(e.target)) return permLabel(e.target);
    if (targetIsReadable(e.action)) return e.target;
    return null;
  };
  const resetFilters = () => {
    setActorId(ALL);
    setLocationId(ALL);
    setResult(ALL);
    setLimit(FIRST_PAGE);
  };
  const filtered = actorId !== ALL || locationId !== ALL || result !== ALL;
  const rows = q.data ?? [];

  return (
    <Panel title={t("activity.title")} subtitle={t("activity.subtitle")} bodyClassName="p-0">
      <div className="flex flex-wrap items-end gap-3 border-b px-5 pb-4 pt-3">
        <FilterSelect
          id="activity-member"
          label={t("activity.filters.member")}
          value={actorId}
          onChange={(v) => {
            setActorId(v);
            setLimit(FIRST_PAGE);
          }}
          options={[
            { value: ALL, label: t("activity.filters.allMembers") },
            ...members.map((m) => ({
              value: m.user_id,
              label: m.full_name ?? t("page.unnamed"),
            })),
          ]}
        />
        <FilterSelect
          id="activity-store"
          label={t("activity.filters.store")}
          value={locationId}
          onChange={(v) => {
            setLocationId(v);
            setLimit(FIRST_PAGE);
          }}
          options={[
            { value: ALL, label: t("page.allStores") },
            ...org.locations.flatMap((l) => (l.dbId ? [{ value: l.dbId, label: l.name }] : [])),
          ]}
        />
        <FilterSelect
          id="activity-result"
          label={t("activity.filters.result")}
          value={result}
          onChange={(v) => {
            setResult(v as AuditEntry["result"] | typeof ALL);
            setLimit(FIRST_PAGE);
          }}
          options={[
            { value: ALL, label: t("activity.filters.allResults") },
            { value: "success", label: t("activity.result.success") },
            { value: "denied", label: t("activity.result.denied") },
            { value: "error", label: t("activity.result.error") },
          ]}
        />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            {t("activity.filters.clear")}
          </Button>
        )}
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-2 p-5" role="status" aria-label={t("common.loading")}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : q.isError ? (
        <StateCard
          tone="danger"
          icon={<History className="size-5" strokeWidth={1.75} />}
          title={t("activity.loadFailed")}
          action={
            <Button variant="outline" onClick={() => void q.refetch()}>
              <RotateCw className="size-3.5" />
              {t("common.retry")}
            </Button>
          }
        />
      ) : !rows.length ? (
        <EmptyState
          icon={<History className="size-5" strokeWidth={1.75} />}
          title={filtered ? t("activity.emptyFiltered") : t("activity.empty")}
          body={result === "denied" ? t("activity.noDenied") : undefined}
        />
      ) : (
        <>
          <div className="max-h-[640px] overflow-auto" aria-busy={q.isFetching}>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {t("activity.cols.when")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("activity.cols.member")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("activity.cols.action")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("activity.cols.store")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t("activity.cols.result")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((e) => {
                  const detail = detailOf(e);
                  return (
                    <tr key={e.id}>
                      <td className="tabular whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                        {fmtDateTime(e.created_at, i18n.language)}
                      </td>
                      <td className="px-3 py-2.5">{nameOf(e.actor_id)}</td>
                      <td className="px-3 py-2.5">
                        <span className="block">{actionOf(e.action)}</span>
                        {detail && (
                          <span className="block text-xs text-muted-foreground">{detail}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[13px]">{storeOf(e.location_id)}</td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={
                            e.result === "denied"
                              ? "danger"
                              : e.result === "error"
                                ? "warning"
                                : "success"
                          }
                        >
                          {t(`activity.result.${e.result}`)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
            <span>{t("activity.showing", { count: rows.length })}</span>
            {rows.length >= limit && limit < MAX_PAGE && (
              <Button
                variant="outline"
                size="sm"
                disabled={q.isFetching}
                aria-busy={q.isFetching}
                onClick={() => setLimit(MAX_PAGE)}
              >
                {t("activity.loadMore")}
              </Button>
            )}
            {rows.length >= MAX_PAGE && <span>{t("activity.limitReached")}</span>}
          </div>
        </>
      )}
    </Panel>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 sm:w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
