import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight, Loader2, ReceiptText, RefreshCw, Search, ShoppingBag, X } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel, Segmented } from "@/components/app/page";
import { StatTile } from "@/components/app/stat-tile";
import { EmptyState, StateCard, Skeleton } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Pager, SortableTh } from "@/components/app/data-table";
import { useSort } from "@/lib/use-sort";
import { OrderStatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { changeOperationalOrder } from "@/lib/operational.functions";
import {
  fetchAllOrders,
  netSalesCents,
  nextStatus,
  OPEN_STATUSES,
  periodStart,
  type OrderStatus,
  type RecordedOrder,
} from "@/lib/recorded-data";
import { isRecordedSale } from "@/lib/report-metrics";
import { displayAmount, fmtDateTime, fmtMoneyCents, fmtNumber, fmtRatePpm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { averageCents } from "@/lib/money";
import { FormSelect } from "@/components/ui/form-select";

export const Route = createFileRoute("/_authenticated/_app/orders")({
  head: () => ({
    meta: [
      { title: "Orders · Dinequora" },
      { name: "description", content: "Recorded orders across channels and stores." },
    ],
  }),
  component: OrdersPage,
});

type Period = "today" | "7d" | "30d" | "90d";
const STATUSES: OrderStatus[] = ["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"];
const CHANNELS = ["dine_in", "takeout", "delivery"] as const;
const PAGE_SIZE = 20;

function OrdersPage() {
  const { t, i18n } = useTranslation("orders");
  const lng = i18n.language;
  const { org, locationId, can, canAny } = useWorkspace();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number] | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryKey = ["recorded-orders", org.id, locationId, period] as const;
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchAllOrders(org.id, locationId, periodStart(period)),
  });
  const tzOf = (slug: string) => org.locations.find((l) => l.id === slug)?.timezone;
  const storeName = (slug: string) => org.locations.find((l) => l.id === slug)?.name ?? slug;

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (status === "all" || o.status === status) &&
        (channel === "all" || o.type === channel) &&
        (!q ||
          o.orderNumber.toLowerCase().includes(q) ||
          o.customer.name.toLowerCase().includes(q)),
    );
  }, [orders, status, channel, search]);

  const kpi = useMemo(() => {
    const valid = orders.filter(isRecordedSale); // paid, not cancelled — same rule as the ledger
    const net = valid.reduce((s, o) => s + netSalesCents(o), 0);
    return {
      count: orders.length,
      cancelled: orders.length - orders.filter((o) => o.status !== "cancelled").length,
      net,
      avg: displayAmount(() => averageCents(net, valid.length), "money.orders_average"),
      open: orders.filter((o) => OPEN_STATUSES.includes(o.status)).length,
    };
  }, [orders]);

  // Column sorting reorders the filtered orders on screen only (default: loaded order, newest first).
  const { sorted, sort, toggle } = useSort(filtered, {
    order: (o) => o.orderNumber,
    time: (o) => Date.parse(o.createdAt),
    store: (o) => storeName(o.locationId),
    channel: (o) => t(`types.${o.type}`),
    customer: (o) => o.customer.tableNumber || o.customer.name,
    items: (o) => o.items.reduce((sum, i) => sum + i.quantity, 0),
    total: (o) => o.totalCents,
    status: (o) => STATUSES.indexOf(o.status),
  });
  const toggleSort = (key: Parameters<typeof toggle>[0]) => {
    toggle(key);
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const hasFilters = status !== "all" || channel !== "all" || search.trim() !== "";
  const resetPage =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={<span className="eyebrow">{org.name}</span>}
        title={t("page.title")}
        description={t("page.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("page.retry")}
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
            </Button>
            <Button asChild>
              <Link to="/pos">
                <ShoppingBag /> {t("page.newSale")}
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={t("page.period")}
          value={period}
          onChange={resetPage(setPeriod)}
          options={(["today", "7d", "30d", "90d"] as const).map((p) => ({
            value: p,
            label: t(`page.periods.${p}`),
          }))}
        />
      </div>

      {error ? (
        <div className="surface">
          <StateCard
            tone="danger"
            icon={<ReceiptText className="size-5" />}
            title={t("page.loadFailed")}
            action={
              <Button variant="outline" onClick={() => void refetch()}>
                {t("page.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {isLoading ? (
              Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-[92px] rounded-xl" />
              ))
            ) : (
              <>
                <StatTile
                  label={t("page.kpi.orders")}
                  value={fmtNumber(kpi.count, lng)}
                  hint={t("page.kpi.ordersHint", { count: kpi.cancelled })}
                  tone={kpi.cancelled ? "warning" : "neutral"}
                />
                <StatTile
                  label={t("page.kpi.netSales")}
                  value={fmtMoneyCents(kpi.net, lng)}
                  hint={t("page.kpi.netSalesHint")}
                />
                <StatTile
                  label={t("page.kpi.avgTicket")}
                  value={fmtMoneyCents(kpi.avg, lng)}
                  hint={t("page.kpi.avgTicketHint")}
                />
                <StatTile
                  label={t("page.kpi.open")}
                  value={fmtNumber(kpi.open, lng)}
                  hint={t("page.kpi.openHint")}
                  tone={kpi.open ? "warning" : "neutral"}
                />
              </>
            )}
          </div>

          <Panel bodyClassName="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => resetPage(setSearch)(e.target.value)}
                  placeholder={t("page.searchPlaceholder")}
                  aria-label={t("page.searchPlaceholder")}
                  className="pl-8"
                />
              </div>
              <FilterSelect
                label={t("page.allStatuses")}
                value={status}
                onChange={resetPage(setStatus)}
                options={STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
              />
              <FilterSelect
                label={t("page.allChannels")}
                value={channel}
                onChange={resetPage(setChannel)}
                options={CHANNELS.map((c) => ({ value: c, label: t(`types.${c}`) }))}
              />
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatus("all");
                    setChannel("all");
                    setSearch("");
                    setPage(1);
                  }}
                >
                  <X /> {t("page.clearFilters")}
                </Button>
              )}
            </div>

            {data?.truncated && (
              <p className="border-b bg-warning/10 px-4 py-2 text-xs">
                {t("page.truncated", { shown: data.orders.length, total: data.total })}
              </p>
            )}

            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <EmptyState
                icon={<ReceiptText className="size-5" />}
                title={t("page.emptyTitle")}
                body={t("page.emptyBody")}
                action={
                  <Button asChild variant="outline">
                    <Link to="/pos">{t("page.newSale")}</Link>
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Search className="size-5" />}
                title={t("page.noMatchTitle")}
                body={t("page.noMatchBody")}
              />
            ) : (
              <>
                {/* Phone: one card per order (no sideways scrolling); tablet/desktop: sortable table. */}
                <ul className="divide-y md:hidden">
                  {rows.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(o.id)}
                        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[13px] font-medium">{o.orderNumber}</span>
                          <OrderStatusBadge status={o.status} label={t(`statuses.${o.status}`)} />
                        </span>
                        <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {fmtDateTime(o.createdAt, lng, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: tzOf(o.locationId),
                            })}
                            {" · "}
                            {t(`types.${o.type}`)}
                            {" · "}
                            {o.customer.tableNumber
                              ? t("detail.table", { table: o.customer.tableNumber })
                              : o.customer.name}
                          </span>
                          <span className="tabular shrink-0 font-medium text-foreground">
                            {fmtMoneyCents(o.totalCents, lng)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="data-table min-w-[760px] text-left">
                    <thead>
                      <tr>
                        <SortableTh
                          label={t("page.col.order")}
                          sortKey="order"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        <SortableTh
                          label={t("page.col.time")}
                          sortKey="time"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        {locationId === "all" && (
                          <SortableTh
                            label={t("page.col.store")}
                            sortKey="store"
                            sort={sort}
                            onSort={toggleSort}
                          />
                        )}
                        <SortableTh
                          label={t("page.col.channel")}
                          sortKey="channel"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        <SortableTh
                          label={t("page.col.customer")}
                          sortKey="customer"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        <SortableTh
                          label={t("page.col.items")}
                          sortKey="items"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label={t("page.col.total")}
                          sortKey="total"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label={t("page.col.status")}
                          sortKey="status"
                          sort={sort}
                          onSort={toggleSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr
                          key={o.id}
                          tabIndex={0}
                          aria-selected={o.id === selectedId}
                          onClick={() => setSelectedId(o.id)}
                          onKeyDown={(e) =>
                            (e.key === "Enter" || e.key === " ") && setSelectedId(o.id)
                          }
                          className="cursor-pointer focus-visible:bg-secondary focus-visible:outline-none"
                        >
                          <td className="font-mono text-[13px] font-medium">
                            {o.orderNumber}
                            {o.isSimulated && (
                              <Badge variant="warning" className="ml-2 align-middle">
                                {t("page.simulated")}
                              </Badge>
                            )}
                          </td>
                          <td className="tabular whitespace-nowrap text-muted-foreground">
                            {fmtDateTime(o.createdAt, lng, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: tzOf(o.locationId),
                            })}
                          </td>
                          {locationId === "all" && (
                            <td className="whitespace-nowrap">{storeName(o.locationId)}</td>
                          )}
                          <td className="whitespace-nowrap">{t(`types.${o.type}`)}</td>
                          <td className="max-w-[220px] truncate">
                            {o.customer.tableNumber
                              ? t("detail.table", { table: o.customer.tableNumber })
                              : o.customer.name}
                          </td>
                          <td className="tabular text-right">
                            {o.items.reduce((s, i) => s + i.quantity, 0)}
                          </td>
                          <td className="tabular text-right font-medium">
                            {fmtMoneyCents(o.totalCents, lng)}
                          </td>
                          <td>
                            <OrderStatusBadge status={o.status} label={t(`statuses.${o.status}`)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={current}
                  pageCount={pages}
                  pageSize={PAGE_SIZE}
                  total={filtered.length}
                  onPage={setPage}
                />
              </>
            )}
          </Panel>
        </>
      )}

      <OrderSheet
        order={selected}
        storeName={selected ? storeName(selected.locationId) : ""}
        timeZone={selected ? tzOf(selected.locationId) : undefined}
        canCancel={can("orders.refund")}
        canAdvance={canAny(["orders.update", "kds.operate"])}
        onClose={() => setSelectedId(null)}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ["recorded-orders"] })}
      />
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "all";
  onChange: (v: T | "all") => void;
  options: { value: T; label: string }[];
}) {
  return (
    <FormSelect
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T | "all")}
      className="h-9 rounded-md border bg-background px-2.5 text-sm text-foreground shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="all">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </FormSelect>
  );
}

function OrderSheet({
  order,
  storeName,
  timeZone,
  canCancel,
  canAdvance,
  onClose,
  onChanged,
}: {
  order: RecordedOrder | null;
  storeName: string;
  timeZone: string | undefined;
  canCancel: boolean;
  canAdvance: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation("orders");
  const lng = i18n.language;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const next = order && canAdvance ? nextStatus(order.status) : null;
  const dateTime = (iso: string) =>
    fmtDateTime(iso, lng, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone,
    });

  const run = async (status: OrderStatus, reason: string, okKey: string) => {
    if (!order) return;
    setBusy(true);
    try {
      await changeOperationalOrder({ data: { id: order.id, status, reason } });
      toast.success(t(okKey, { status: t(`statuses.${status}`) }));
      onChanged();
    } catch (e) {
      toast.error(t("detail.actionFailed", { reason: e instanceof Error ? e.message : "unknown" }));
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {order && (
          <>
            <SheetHeader className="border-b p-5 text-left">
              <div className="flex items-center gap-2">
                <SheetTitle className="font-mono">
                  {t("detail.title", { number: order.orderNumber })}
                </SheetTitle>
                <OrderStatusBadge status={order.status} label={t(`statuses.${order.status}`)} />
              </div>
              <SheetDescription>
                {[
                  storeName,
                  t(`types.${order.type}`),
                  t("detail.placedAt", { time: dateTime(order.createdAt) }),
                ].join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-5 text-sm">
              <section>
                <h3 className="eyebrow mb-2">{t("detail.items")}</h3>
                <ul className="divide-y">
                  {order.items.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          <span className="tabular text-muted-foreground">{i.quantity}× </span>
                          {i.productName}
                        </p>
                        {i.modifiers.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {i.modifiers.map((m) => m.optionName).join(", ")}
                          </p>
                        )}
                        {i.notes && <p className="text-xs text-muted-foreground">“{i.notes}”</p>}
                      </div>
                      <span className="tabular shrink-0">
                        {fmtMoneyCents(i.subtotalCents, lng)}
                      </span>
                    </li>
                  ))}
                </ul>
                {order.specialInstructions && (
                  <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
                    <span className="font-medium">{t("detail.notes")}: </span>
                    {order.specialInstructions}
                  </p>
                )}
              </section>

              <section>
                <dl className="space-y-1.5">
                  <Row
                    label={t("detail.subtotal")}
                    value={fmtMoneyCents(order.subtotalCents, lng)}
                  />
                  {order.discountCents > 0 && (
                    <Row
                      label={t("detail.discount")}
                      value={`− ${fmtMoneyCents(order.discountCents, lng)}`}
                    />
                  )}
                  <Row
                    label={t("detail.tax", { rate: fmtRatePpm(order.taxRatePpm, lng) })}
                    value={fmtMoneyCents(order.taxCents, lng)}
                  />
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <dt>{t("detail.total")}</dt>
                    <dd className="tabular">{fmtMoneyCents(order.totalCents, lng)}</dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3 className="eyebrow mb-2">{t("detail.timeline")}</h3>
                <ol className="space-y-2 border-l pl-4">
                  {[...order.timeline]
                    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
                    .map((ev) => (
                      <li key={ev.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border" />
                        <p className="font-medium">{t(`statuses.${ev.toStatus}`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {dateTime(ev.timestamp)}
                          {ev.note ? ` · ${ev.note}` : ""}
                        </p>
                      </li>
                    ))}
                </ol>
              </section>
            </div>

            {(next || (canCancel && order.status !== "cancelled")) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
                {canCancel && order.status !== "cancelled" ? (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setConfirmCancel(true)}
                  >
                    {t("detail.cancel")}
                  </Button>
                ) : (
                  <span />
                )}
                {next && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        next,
                        t("detail.advanced", { status: t(`statuses.${next}`) }),
                        "detail.advanced",
                      )
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    {t("detail.advance", { status: t(`statuses.${next}`) })}
                  </Button>
                )}
              </div>
            )}

            <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("detail.cancelTitle", { number: order.orderNumber })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t("detail.cancelBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t("detail.keep")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      void run("cancelled", t("detail.cancelReasonDefault"), "detail.cancelled");
                    }}
                  >
                    {busy && <Loader2 className="animate-spin" />}
                    {t("detail.confirmCancel")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className="tabular text-foreground">{value}</dd>
    </div>
  );
}
