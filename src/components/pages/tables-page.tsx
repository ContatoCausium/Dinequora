import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  Armchair,
  CalendarClock,
  CircleCheck,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Segmented } from "@/components/app/page";
import { EmptyState, Skeleton, StateCard } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import type { StatusTone } from "@/components/app/status-styles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtMoneyCents, fmtNumber } from "@/lib/format";
import {
  TABLE_STATUSES,
  countByStatus,
  diningErrorKey,
  groupFloor,
  seatsByStatus,
  type DiningRoom,
  type DiningSection,
  type DiningTable,
  type DraftLine,
  type OpenSession,
  type TableStatus,
} from "@/lib/dining-room";
import { CheckSheet, SeatDialog } from "@/components/tables/check-sheet";
import { DaySummaryPanel } from "@/components/tables/day-summary";
import {
  archiveDiningSection,
  archiveDiningTable,
  fetchDiningRoom,
  saveDiningSection,
  saveDiningTable,
  setDiningTableStatus,
} from "@/lib/operational.functions";

/** Status vocabulary of the floor: icon + label everywhere, never color alone. */
const STATUS_STYLE: Record<TableStatus, { tone: StatusTone; icon: LucideIcon }> = {
  available: { tone: "success", icon: CircleCheck },
  occupied: { tone: "brand", icon: Users },
  reserved: { tone: "warning", icon: CalendarClock },
  cleaning: { tone: "neutral", icon: Sparkles },
};
/** Card accent per status (border + soft fill), paired with the badge text. */
const CARD_STYLE: Record<TableStatus, string> = {
  available: "border-success/30",
  occupied: "border-primary/35 bg-primary-soft/40",
  reserved: "border-warning/35 bg-warning/5",
  cleaning: "border-border bg-muted/40",
};

/** Time in the current status: "just now", "12 min", "2h 05m", "3 days". */
function formatSince(iso: string, now: number, t: TFunction<"tables">): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return t("card.justNow");
  if (minutes < 60) return t("card.minutes", { count: minutes });
  if (minutes < 1440)
    return t("card.hours", {
      hours: Math.floor(minutes / 60),
      minutes: String(minutes % 60).padStart(2, "0"),
    });
  return t("card.days", { count: Math.floor(minutes / 1440) });
}

/** "for 12 min" in the current status; "changed just now" under a minute. */
function sinceText(iso: string, now: number, t: TFunction<"tables">): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  return minutes < 1 ? t("card.justNow") : t("card.since", { time: formatSince(iso, now, t) });
}

type TableForm = { id: string | null; label: string; seats: string; sectionId: string | null };
type SectionForm = { id: string | null; name: string };
const NO_SECTION = "__none__";

export function TablesPage() {
  const { t } = useTranslation("tables");
  const { org, locationId, can } = useWorkspace();
  const store =
    locationId !== "all"
      ? (org.locations.find((l) => l.id === locationId) ?? null)
      : org.locations.length === 1
        ? org.locations[0]!
        : null;

  if (!store) {
    const none = org.locations.length === 0;
    return (
      <div>
        <PageHeader title={t("title")} />
        <EmptyState
          icon={<Store />}
          title={t(none ? "states.noStoreTitle" : "states.chooseStoreTitle")}
          body={t(none ? "states.noStoreBody" : "states.chooseStoreBody")}
        />
      </div>
    );
  }
  return (
    <Floor
      key={`${org.id}:${store.id}`}
      orgId={org.id}
      storeId={store.id}
      storeName={store.name}
      canStatus={can("tables.status")}
      canManage={can("tables.manage")}
      canServe={can("tables.serve")}
      canSell={can("pos.sell")}
      canRefund={can("orders.refund")}
    />
  );
}

function Floor({
  orgId,
  storeId,
  storeName,
  canStatus,
  canManage,
  canServe,
  canSell,
  canRefund,
}: {
  orgId: string;
  storeId: string;
  storeName: string;
  canStatus: boolean;
  canManage: boolean;
  canServe: boolean;
  canSell: boolean;
  canRefund: boolean;
}) {
  const { t, i18n } = useTranslation("tables");
  const queryClient = useQueryClient();
  const queryKey = ["dining-room", orgId, storeId] as const;
  const room = useQuery({
    queryKey,
    queryFn: () => fetchDiningRoom({ data: { orgId, locationId: storeId } }),
    // Several people work the same floor: a safety-net reload, on top of the reload after each change.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const [filter, setFilter] = useState<TableStatus | "all">("all");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [tableForm, setTableForm] = useState<TableForm | null>(null);
  const [sectionForm, setSectionForm] = useState<SectionForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveTable, setArchiveTable] = useState<DiningTable | null>(null);
  const [archiveSection, setArchiveSection] = useState<DiningSection | null>(null);
  const [seatTable, setSeatTable] = useState<DiningTable | null>(null);
  // A menu item that opens a dialog: the closing menu must not take the focus back to its trigger,
  // or the dialog (and its first field) would lose it (keyboard and screen-reader users).
  const dialogFromMenu = useRef(false);
  const keepFocusForDialog = (e: Event) => {
    if (dialogFromMenu.current) e.preventDefault();
    dialogFromMenu.current = false;
  };
  // The check shown in the side sheet, by table (the session follows the party when it moves).
  const [checkTableId, setCheckTableId] = useState<string | null>(null);
  const [checkSessionId, setCheckSessionId] = useState<string | null>(null);
  // Rounds being prepared, per check, kept while the screen is open (not sent = not recorded).
  const [drafts, setDrafts] = useState<Record<string, DraftLine[]>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const reload = () => queryClient.invalidateQueries({ queryKey });
  const errorText = (e: unknown) => t(`errors.${diningErrorKey(e)}`);
  const statusLabel = (s: TableStatus) => t(`status.${s}`);

  async function changeStatus(table: DiningTable, status: TableStatus) {
    setBusy(table.id);
    try {
      const r = await setDiningTableStatus({
        data: { orgId, locationId: storeId, id: table.id, status, expected: table.status },
      });
      if (r.conflict)
        toast.warning(
          r.status
            ? t("toast.conflict", { label: table.label, status: statusLabel(r.status) })
            : t("toast.conflictUnknown", { label: table.label }),
        );
      else
        toast.success(
          t("toast.statusChanged", { label: table.label, status: statusLabel(status) }),
        );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  async function submitTable() {
    if (!tableForm) return;
    const seats = Number(tableForm.seats);
    const label = tableForm.label.trim();
    if (label.length < 1 || label.length > 20) return setFormError(t("errors.invalid_label"));
    if (!Number.isInteger(seats) || seats < 1 || seats > 99)
      return setFormError(t("errors.invalid_seats"));
    setBusy("table-form");
    setFormError(null);
    try {
      await saveDiningTable({
        data: {
          orgId,
          locationId: storeId,
          id: tableForm.id,
          label,
          seats,
          sectionId: tableForm.sectionId,
          sortOrder: 0,
        },
      });
      toast.success(t("toast.tableSaved", { label }));
      setTableForm(null);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  async function submitSection() {
    if (!sectionForm) return;
    const name = sectionForm.name.trim();
    if (name.length < 1 || name.length > 60) return setFormError(t("errors.invalid_name"));
    setBusy("section-form");
    setFormError(null);
    try {
      await saveDiningSection({
        data: { orgId, locationId: storeId, id: sectionForm.id, name, sortOrder: 0 },
      });
      toast.success(t("toast.sectionSaved", { name }));
      setSectionForm(null);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  async function confirmArchiveTable() {
    if (!archiveTable) return;
    setBusy("archive");
    try {
      await archiveDiningTable({ data: { orgId, locationId: storeId, id: archiveTable.id } });
      toast.success(t("toast.tableArchived", { label: archiveTable.label }));
      setArchiveTable(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  async function confirmArchiveSection() {
    if (!archiveSection) return;
    setBusy("archive");
    try {
      await archiveDiningSection({ data: { orgId, locationId: storeId, id: archiveSection.id } });
      toast.success(t("toast.sectionArchived", { name: archiveSection.name }));
      setArchiveSection(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await reload();
      setBusy(null);
    }
  }

  const data: DiningRoom | undefined = room.data;
  const counts = useMemo(() => (data ? countByStatus(data) : null), [data]);
  const groups = useMemo(() => (data ? groupFloor(data, filter) : []), [data, filter]);
  const openNewTable = (sectionId: string | null = null) => {
    setFormError(null);
    setTableForm({ id: null, label: "", seats: "4", sectionId });
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description", { store: storeName })}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void reload()}
              disabled={room.isFetching}
            >
              <RefreshCw className={cn(room.isFetching && "animate-spin")} aria-hidden />
              {t("actions.refresh")}
            </Button>
            {canManage && data && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormError(null);
                    setSectionForm({ id: null, name: "" });
                  }}
                >
                  <Plus aria-hidden />
                  {t("actions.newSection")}
                </Button>
                <Button size="sm" onClick={() => openNewTable()}>
                  <Plus aria-hidden />
                  {t("actions.newTable")}
                </Button>
              </>
            )}
          </>
        }
      />

      {room.isPending ? (
        <div aria-busy="true" aria-label={t("states.loading")} className="space-y-4">
          <Skeleton className="h-9 w-full max-w-xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      ) : room.isError || !data || !counts ? (
        <StateCard
          tone="danger"
          icon={<TriangleAlert />}
          title={t("states.errorTitle")}
          body={t("states.errorBody")}
          action={
            <Button variant="outline" onClick={() => void room.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : data.tables.length === 0 && data.sections.length === 0 ? (
        <EmptyState
          icon={<Armchair />}
          title={t("states.emptyTitle")}
          body={t(canManage ? "states.emptyManage" : "states.emptyReadOnly")}
          action={
            canManage ? (
              <Button onClick={() => openNewTable()}>
                <Plus aria-hidden />
                {t("actions.newTable")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {(canServe || canManage) && (
            <div className="mb-3">
              <DaySummaryPanel orgId={orgId} storeId={storeId} />
            </div>
          )}
          <section aria-label={t("summary.label")} className="mb-5 space-y-3">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TABLE_STATUSES.map((s) => {
                const style = STATUS_STYLE[s];
                const Icon = style.icon;
                return (
                  <li key={s} className="surface flex items-center gap-3 px-4 py-3">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-muted-foreground">{statusLabel(s)}</p>
                      <p className="text-lg font-semibold tabular-nums leading-tight">
                        {fmtNumber(counts[s], i18n.language)}
                        <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">
                          {t("summary.seats", { count: seatsByStatus(data, s) })}
                        </span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="-mx-1 overflow-x-auto px-1 pb-1 [&_button]:whitespace-nowrap">
              <Segmented
                label={t("filter.label")}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: t("filter.all", { count: data.tables.length }) },
                  ...TABLE_STATUSES.map((s) => ({
                    value: s,
                    label: t("filter.status", { label: statusLabel(s), count: counts[s] }),
                  })),
                ]}
              />
            </div>
          </section>

          <div className="space-y-6">
            {groups.map((g) => (
              <section
                key={g.section?.id ?? NO_SECTION}
                aria-labelledby={`section-${g.section?.id ?? NO_SECTION}`}
              >
                <header className="mb-2.5 flex items-center justify-between gap-3">
                  <h2
                    id={`section-${g.section?.id ?? NO_SECTION}`}
                    className="text-[15px] font-semibold tracking-[-0.01em]"
                  >
                    {g.section?.name ?? t("section.none")}
                    <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
                      {t("section.count", {
                        count: data.tables.filter((x) => x.sectionId === (g.section?.id ?? null))
                          .length,
                      })}
                    </span>
                  </h2>
                  {canManage && g.section && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("section.actions", { name: g.section.name })}
                        >
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onCloseAutoFocus={keepFocusForDialog}>
                        <DropdownMenuItem
                          onSelect={() => {
                            dialogFromMenu.current = true;
                            openNewTable(g.section!.id);
                          }}
                        >
                          {t("actions.newTable")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            dialogFromMenu.current = true;
                            setFormError(null);
                            setSectionForm({ id: g.section!.id, name: g.section!.name });
                          }}
                        >
                          {t("section.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => {
                            dialogFromMenu.current = true;
                            setArchiveSection(g.section);
                          }}
                        >
                          {t("section.archive")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </header>
                {g.tables.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
                    {filter === "all" ? t("section.empty") : t("section.emptyFiltered")}
                  </p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {g.tables.map((table) => (
                      <li key={table.id}>
                        <TableCard
                          table={table}
                          session={data.sessions.find((x) => x.tableId === table.id) ?? null}
                          now={now}
                          busy={busy === table.id}
                          canStatus={canStatus}
                          canManage={canManage}
                          canServe={canServe}
                          onSeat={() => setSeatTable(table)}
                          onOpenCheck={() => {
                            const open = data.sessions.find((x) => x.tableId === table.id);
                            setCheckSessionId(open?.id ?? null);
                            setCheckTableId(table.id);
                          }}
                          onStatus={(s) => void changeStatus(table, s)}
                          onEdit={() => {
                            setFormError(null);
                            setTableForm({
                              id: table.id,
                              label: table.label,
                              seats: String(table.seats),
                              sectionId: table.sectionId,
                            });
                          }}
                          onArchive={() => setArchiveTable(table)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <SeatDialog
        table={seatTable}
        orgId={orgId}
        storeId={storeId}
        onClose={() => setSeatTable(null)}
        onSeated={(tableId) => {
          setSeatTable(null);
          setCheckSessionId(null);
          setCheckTableId(tableId);
          void reload();
        }}
      />
      {data &&
        (() => {
          const open =
            data.sessions.find((x) => x.id === checkSessionId) ??
            data.sessions.find((x) => x.tableId === checkTableId) ??
            null;
          return (
            <CheckSheet
              session={checkTableId || checkSessionId ? open : null}
              room={data}
              orgId={orgId}
              storeId={storeId}
              drafts={drafts}
              setDraftFor={(checkId, lines) => setDrafts((d) => ({ ...d, [checkId]: lines }))}
              can={{ serve: canServe, sell: canSell, refund: canRefund }}
              onClose={() => {
                setCheckTableId(null);
                setCheckSessionId(null);
              }}
              reload={reload}
            />
          );
        })()}

      {/* Table create / edit */}
      <Dialog
        open={tableForm !== null}
        onOpenChange={(open) => !open && busy === null && setTableForm(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tableForm?.id ? t("form.editTable", { label: tableForm.label }) : t("form.newTable")}
            </DialogTitle>
            <DialogDescription>{t("form.tableHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitTable();
            }}
          >
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dining-table-label">{t("form.label")}</Label>
                <Input
                  id="dining-table-label"
                  value={tableForm?.label ?? ""}
                  onChange={(e) => setTableForm((f) => (f ? { ...f, label: e.target.value } : f))}
                  maxLength={20}
                  required
                  autoFocus
                  aria-invalid={formError !== null}
                  aria-describedby={formError ? "dining-form-error" : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dining-table-seats">{t("form.seats")}</Label>
                <Input
                  id="dining-table-seats"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  step={1}
                  value={tableForm?.seats ?? ""}
                  onChange={(e) => setTableForm((f) => (f ? { ...f, seats: e.target.value } : f))}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-table-section">{t("form.section")}</Label>
              <Select
                value={tableForm?.sectionId ?? NO_SECTION}
                onValueChange={(v) =>
                  setTableForm((f) => (f ? { ...f, sectionId: v === NO_SECTION ? null : v } : f))
                }
              >
                <SelectTrigger id="dining-table-section">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SECTION}>{t("form.noSection")}</SelectItem>
                  {data?.sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <p id="dining-form-error" role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setTableForm(null)}
              >
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "table-form"
                  ? t("form.saving")
                  : tableForm?.id
                    ? t("form.save")
                    : t("form.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Section create / rename */}
      <Dialog
        open={sectionForm !== null}
        onOpenChange={(open) => !open && busy === null && setSectionForm(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {sectionForm?.id
                ? t("form.editSection", {
                    name: data?.sections.find((s) => s.id === sectionForm.id)?.name ?? "",
                  })
                : t("form.newSection")}
            </DialogTitle>
            <DialogDescription>{t("form.sectionHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitSection();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="dining-section-name">{t("form.name")}</Label>
              <Input
                id="dining-section-name"
                value={sectionForm?.name ?? ""}
                onChange={(e) => setSectionForm((f) => (f ? { ...f, name: e.target.value } : f))}
                maxLength={60}
                required
                autoFocus
                aria-invalid={formError !== null}
                aria-describedby={formError ? "dining-section-error" : undefined}
              />
            </div>
            {formError && (
              <p id="dining-section-error" role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setSectionForm(null)}
              >
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "section-form"
                  ? t("form.saving")
                  : sectionForm?.id
                    ? t("form.save")
                    : t("form.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive confirmations */}
      <Dialog
        open={archiveTable !== null}
        onOpenChange={(open) => !open && busy === null && setArchiveTable(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("archiveTable.title", { label: archiveTable?.label ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("archiveTable.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setArchiveTable(null)}
            >
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmArchiveTable()}
            >
              {t("archiveTable.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={archiveSection !== null}
        onOpenChange={(open) => !open && busy === null && setArchiveSection(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("archiveSection.title", { name: archiveSection?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("archiveSection.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setArchiveSection(null)}
            >
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmArchiveSection()}
            >
              {t("archiveSection.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TableCard({
  table,
  session,
  now,
  busy,
  canStatus,
  canManage,
  canServe,
  onStatus,
  onEdit,
  onArchive,
  onSeat,
  onOpenCheck,
}: {
  table: DiningTable;
  session: OpenSession | null;
  now: number;
  busy: boolean;
  canStatus: boolean;
  canManage: boolean;
  canServe: boolean;
  onStatus: (s: TableStatus) => void;
  onEdit: () => void;
  onArchive: () => void;
  onSeat: () => void;
  onOpenCheck: () => void;
}) {
  const { t, i18n } = useTranslation("tables");
  const dialogFromMenu = useRef(false);
  // Open the dialog only after the menu has closed and given up the focus.
  const viaDialog = (fn: () => void) => () => {
    dialogFromMenu.current = true;
    window.setTimeout(fn, 0);
  };
  const style = STATUS_STYLE[table.status];
  const status = t(`status.${table.status}`);
  const seats = t("card.seats", { count: table.seats });
  const party = session
    ? t("card.party", {
        count: session.guests,
        total: fmtMoneyCents(session.liveTotalCents, i18n.language),
      })
    : null;
  const canSeat =
    canServe && !session && (table.status === "available" || table.status === "reserved");
  // While a party is seated the table stays occupied (0038): no manual status change is offered.
  const statusChoices = canStatus && !session;
  const interactive = statusChoices || canManage || canSeat || session !== null;
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="truncate text-xl font-semibold tracking-[-0.02em]">{table.label}</span>
        {interactive && (
          <MoreHorizontal className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{party ?? seats}</span>
      <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone={style.tone} icon={style.icon}>
          {status}
        </StatusBadge>
        <span className="text-[12px] text-muted-foreground">
          {sinceText(session?.openedAt ?? table.statusChangedAt, now, t)}
        </span>
      </span>
    </>
  );
  const cardClass = cn(
    "block h-full w-full rounded-xl border bg-card p-3.5 text-left transition-colors",
    CARD_STYLE[table.status],
  );
  const name = t("card.actions", { label: table.label, status, seats: party ?? seats });

  if (!interactive)
    return (
      <div
        role="group"
        className={cardClass}
        aria-label={t("card.readOnly", { label: table.label, status, seats })}
      >
        {body}
      </div>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label={name}
          className={cn(
            cardClass,
            "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          )}
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52"
        onCloseAutoFocus={(e) => {
          if (dialogFromMenu.current) e.preventDefault();
          dialogFromMenu.current = false;
        }}
      >
        {session && (
          <DropdownMenuItem onSelect={viaDialog(onOpenCheck)}>
            {t("menu.openCheck")}
          </DropdownMenuItem>
        )}
        {canSeat && (
          <DropdownMenuItem onSelect={viaDialog(onSeat)}>{t("menu.seat")}</DropdownMenuItem>
        )}
        {statusChoices && (
          <>
            {(session || canSeat) && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{t("menu.changeStatus")}</DropdownMenuLabel>
            {TABLE_STATUSES.map((s) => {
              const Icon = STATUS_STYLE[s].icon;
              const label = t(`status.${s}`);
              return (
                <DropdownMenuItem
                  key={s}
                  disabled={s === table.status}
                  onSelect={() => onStatus(s)}
                >
                  <Icon aria-hidden />
                  {s === table.status
                    ? t("menu.current", { status: label })
                    : t("menu.markAs", { status: label.toLowerCase() })}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        {canManage && (
          <>
            {(statusChoices || session || canSeat) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={viaDialog(onEdit)}>{t("menu.edit")}</DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={session !== null}
              onSelect={viaDialog(onArchive)}
            >
              {t("menu.archive")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
