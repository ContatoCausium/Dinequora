import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CookingPot,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Play,
  Check,
  RotateCcw,
  Sparkles,
  UtensilsCrossed,
  BellRing,
  BellOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/app/workspace-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { captureError } from "@/lib/observability";
import { Order, OrderStatus, KitchenStation, listOrders } from "@/lib/orders-service";
import {
  calculateElapsedMinutes,
  getTicketUrgency,
  filterOrdersByStation,
  assignDefaultStation,
  simulateIncomingOrder,
} from "@/lib/kds-service";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPersistedOrders,
  persistOrderStatusTransition,
} from "@/lib/orders-persistence-service";
import { setOperationalItemReady } from "@/lib/operational.functions";

export const Route = createFileRoute("/_authenticated/_app/kds")({
  head: () => ({
    meta: [
      { title: "Kitchen Display System (KDS) · Servora" },
      {
        name: "description",
        content: "Authorized restaurant kitchen tickets and recorded status transitions.",
      },
      { property: "og:title", content: "Kitchen Display System (KDS) · Servora" },
      {
        property: "og:description",
        content: "Authorized restaurant kitchen tickets and recorded status transitions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KDSPage,
});

const STATIONS: (KitchenStation | "all")[] = ["all", "grill", "fryer", "assembly", "bar", "expo"];

type WindowWithLegacyAudio = Window & { webkitAudioContext?: typeof AudioContext };

/** Short chime for new tickets; silently skipped where Web Audio is unavailable. */
function playNewTicketChime() {
  if (typeof window === "undefined") return;
  const legacy: WindowWithLegacyAudio = window;
  const AudioCtx = window.AudioContext ?? legacy.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Audio playback can be blocked by autoplay policies; the alert is best-effort.
  }
}

/** Waiting time in the active language: "12 min", "3h 05m", "2d". */
function formatAge(minutes: number, t: TFunction<"kds">): string {
  if (minutes < 60) return t("age.minutes", { count: minutes });
  if (minutes < 1440) {
    return t("age.hours", {
      hours: Math.floor(minutes / 60),
      minutes: String(minutes % 60).padStart(2, "0"),
    });
  }
  return t("age.days", { count: Math.floor(minutes / 1440) });
}

export function KDSPage() {
  const { t } = useTranslation("kds");
  const { org, orgDbId, locationId, role } = useWorkspace();
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);
  // Real organizations: the board shows persisted tickets only (filled by the fetch below), never
  // browser-local leftovers such as simulated tickets. Local tickets exist only for demo orgs.
  const [orders, setOrders] = useState<Order[]>(() =>
    org.fictional ? listOrders(org.id, locationId, locationScope) : [],
  );
  const [stationFilter, setStationFilter] = useState<KitchenStation | "all">("all");
  const [nowTick, setNowTick] = useState(Date.now());
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingItems, setPendingItems] = useState<ReadonlySet<string>>(() => new Set());
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("connecting");

  const refreshPersistedData = async () => {
    try {
      const res = await fetchPersistedOrders({
        orgId: org.id,
        locationId: locationId === "all" ? undefined : locationId,
        limit: 100,
      });
      if (res.unavailable) {
        setConnectionStatus("disconnected");
        return;
      }
      setOrders(res.orders);
    } catch (err) {
      captureError(err, { event: "kds.fetch_failed" });
    }
  };

  // Initial fetch from database + 15s safety backup sync
  useEffect(() => {
    setOrders([]);
    void refreshPersistedData();
    const interval = setInterval(() => {
      setNowTick(Date.now());
      void refreshPersistedData();
    }, 15000);
    return () => clearInterval(interval);
  }, [org.id, locationId]);

  // Realtime subscription with explicit unmount cleanup
  useEffect(() => {
    let isMounted = true;
    setConnectionStatus("connecting");

    const channelName = `kds-orders-${org.id}-${locationId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `org_id=eq.${orgDbId}`,
        },
        async (payload) => {
          if (!isMounted) return;
          // Target location check
          const row = payload.new;
          const locDbId = org.locations.find((l) => l.id === locationId)?.dbId;
          if (locationId !== "all" && "location_id" in row && row["location_id"] !== locDbId) {
            return;
          }

          if (payload.eventType === "INSERT" && audioAlerts) {
            playNewTicketChime();
          }

          await refreshPersistedData();
        },
      )
      .subscribe((status) => {
        if (!isMounted) return;
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus("disconnected");
        } else if (status === "CLOSED") {
          setConnectionStatus("disconnected");
        }
      });

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [org.id, locationId, audioAlerts]);

  const filteredOrders = useMemo(() => {
    const list = orders.filter(
      (o) => o.orgId === org.id && (locationId === "all" || o.locationId === locationId),
    );
    return filterOrdersByStation(list, stationFilter);
  }, [orders, org.id, locationId, stationFilter, nowTick]);

  const columns = useMemo(() => {
    const active = filteredOrders.filter((o) => o.status !== "cancelled");
    return {
      new: active.filter((o) => o.status === "new" || o.status === "confirmed"),
      in_prep: active.filter((o) => o.status === "in_prep"),
      ready: active.filter((o) => o.status === "ready"),
      delivered: active.filter((o) => o.status === "delivered").slice(0, 10),
    };
  }, [filteredOrders]);

  const setPending = (setter: typeof setPendingOrders, id: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleStatusChange = async (order: Order, next: OrderStatus) => {
    if (pendingOrders.has(order.id)) return;
    setPending(setPendingOrders, order.id, true);
    try {
      const res = await persistOrderStatusTransition(order.id, next);
      await refreshPersistedData();
      if (!res.success) {
        toast.error(t("toast.syncFailed"));
      } else {
        toast.success(t("toast.moved", { number: order.orderNumber, status: t(`status.${next}`) }));
      }
    } finally {
      setPending(setPendingOrders, order.id, false);
    }
  };

  const handleToggleItem = async (orderId: string, itemId: string) => {
    const item = orders.find((o) => o.id === orderId)?.items.find((i) => i.id === itemId);
    if (!item || pendingItems.has(itemId)) return;
    setPending(setPendingItems, itemId, true);
    try {
      await setOperationalItemReady({ data: { id: itemId, ready: !item.isItemReady } });
      await refreshPersistedData();
    } catch {
      toast.error(t("toast.itemFailed"));
    } finally {
      setPending(setPendingItems, itemId, false);
    }
  };

  const handleSimulateNewOrder = () => {
    if (!org.fictional) return;
    const targetLoc = locationId === "all" ? org.locations[0]?.id || "loc-1" : locationId;
    const newOrd = simulateIncomingOrder(org.id, targetLoc);
    setOrders(listOrders(org.id, locationId, locationScope));
    if (audioAlerts) {
      playNewTicketChime();
    }
    toast.info(t("toast.simulated", { number: newOrd.orderNumber }));
  };

  const connectionVariant =
    connectionStatus === "connected"
      ? "success"
      : connectionStatus === "connecting"
        ? "warning"
        : "danger";
  const connectionDot =
    connectionStatus === "connected"
      ? "bg-success"
      : connectionStatus === "connecting"
        ? "bg-warning animate-pulse"
        : "bg-destructive";

  const cardProps = (order: Order) => ({
    order,
    stationFilter,
    pending: pendingOrders.has(order.id),
    pendingItems,
    onToggleItem: (itemId: string) => handleToggleItem(order.id, itemId),
  });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 lg:h-[calc(100vh-5.5rem)]">
      {/* Top Controls Bar */}
      <div className="surface flex shrink-0 flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3">
          <CookingPot className="size-6 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
              {t("title")}
              <Badge variant={connectionVariant} className="gap-1.5" aria-live="polite">
                <span className={cn("size-1.5 rounded-full", connectionDot)} aria-hidden />
                {t(`connection.${connectionStatus}`)}
              </Badge>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Station Selector */}
          <div
            role="radiogroup"
            aria-label={t("stationsLabel")}
            className="flex flex-wrap items-center rounded-md border bg-muted/40 p-0.5"
          >
            {STATIONS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={stationFilter === s}
                onClick={() => setStationFilter(s)}
                className={cn(
                  "min-h-11 rounded-[5px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  stationFilter === s
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`stations.${s}`)}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            aria-pressed={audioAlerts}
            onClick={() => setAudioAlerts(!audioAlerts)}
            className={cn("h-11", audioAlerts ? "text-foreground" : "text-muted-foreground")}
          >
            {audioAlerts ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
            {audioAlerts ? t("chime.on") : t("chime.off")}
          </Button>

          {org.fictional && (
            <Button variant="outline" onClick={handleSimulateNewOrder} className="h-11">
              <Sparkles aria-hidden /> {t("simulate")}
            </Button>
          )}
        </div>
      </div>

      {/* Kanban Board Layout */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:overflow-hidden">
        <KDSColumn
          title={t("columns.new")}
          count={columns.new.length}
          emptyMessage={t("empty.new")}
        >
          {columns.new.map((order) => (
            <KDSTicketCard
              key={order.id}
              {...cardProps(order)}
              onAdvance={() => handleStatusChange(order, "in_prep")}
              advanceLabel={t("actions.start")}
              advanceIcon={Play}
            />
          ))}
        </KDSColumn>

        <KDSColumn
          title={t("columns.inPrep")}
          count={columns.in_prep.length}
          emptyMessage={t("empty.inPrep")}
        >
          {columns.in_prep.map((order) => (
            <KDSTicketCard
              key={order.id}
              {...cardProps(order)}
              onAdvance={() => handleStatusChange(order, "ready")}
              advanceLabel={t("actions.ready")}
              advanceIcon={Check}
            />
          ))}
        </KDSColumn>

        <KDSColumn
          title={t("columns.ready")}
          count={columns.ready.length}
          emptyMessage={t("empty.ready")}
        >
          {columns.ready.map((order) => (
            <KDSTicketCard
              key={order.id}
              {...cardProps(order)}
              onAdvance={() => handleStatusChange(order, "delivered")}
              advanceLabel={t("actions.fulfill")}
              advanceIcon={CheckCircle2}
            />
          ))}
        </KDSColumn>

        <KDSColumn
          title={t("columns.done")}
          count={columns.delivered.length}
          emptyMessage={t("empty.done")}
        >
          {columns.delivered.map((order) => (
            <KDSTicketCard
              key={order.id}
              {...cardProps(order)}
              onAdvance={() => handleStatusChange(order, "in_prep")}
              advanceLabel={t("actions.reopen")}
              advanceIcon={RotateCcw}
              isCompleted
            />
          ))}
        </KDSColumn>
      </div>
    </div>
  );
}

function KDSColumn({
  title,
  count,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface flex h-full flex-col overflow-hidden" aria-label={title}>
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge variant="neutral" className="tabular px-2 text-xs">
          {count}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-2.5 scrollbar-thin lg:overflow-y-auto">
        {count === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
            <UtensilsCrossed className="mb-2 size-6 opacity-40" aria-hidden />
            <p>{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function KDSTicketCard({
  order,
  stationFilter,
  onAdvance,
  advanceLabel,
  advanceIcon: Icon,
  onToggleItem,
  pending,
  pendingItems,
  isCompleted = false,
}: {
  order: Order;
  stationFilter: KitchenStation | "all";
  onAdvance: () => void;
  advanceLabel: string;
  advanceIcon: React.ElementType;
  onToggleItem: (id: string) => void;
  pending: boolean;
  pendingItems: ReadonlySet<string>;
  isCompleted?: boolean;
}) {
  const { t, i18n } = useTranslation("kds");
  const elapsed = calculateElapsedMinutes(order.createdAt);
  const urgency = isCompleted ? "normal" : getTicketUrgency(order.createdAt);
  const age = formatAge(elapsed, t);
  const placedAt = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(order.createdAt));

  const displayedItems = order.items.filter((item) => {
    if (stationFilter === "all") return true;
    return (item.station || assignDefaultStation(item.productName)) === stationFilter;
  });

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-xs",
        urgency === "warning" && "border-l-4 border-l-warning",
        urgency === "delayed" && "border-l-4 border-l-destructive",
        isCompleted && "opacity-75",
      )}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <p className="font-mono text-xl font-semibold leading-tight tracking-tight">
            {order.orderNumber}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t(`orderType.${order.type}`)}</span>
            {(order.customer.tableNumber || order.customer.name) && (
              <>
                <span aria-hidden>·</span>
                <span className="max-w-[160px] truncate">
                  {order.customer.tableNumber || order.customer.name}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant={
              urgency === "delayed" ? "danger" : urgency === "warning" ? "warning" : "neutral"
            }
            className="tabular gap-1 text-sm"
            title={t("age.waiting", { age })}
          >
            {urgency === "delayed" ? (
              <AlertTriangle className="size-3.5" aria-hidden />
            ) : (
              <Clock className="size-3.5" aria-hidden />
            )}
            {urgency !== "normal" && (
              <span className="sr-only">
                {urgency === "delayed" ? t("age.overdue") : t("age.late")}:
              </span>
            )}
            {age}
          </Badge>
          <span className="tabular text-xs text-muted-foreground">
            {t("ticket.placedAt", { time: placedAt })}
          </span>
        </div>
      </div>

      {/* Items Checklist */}
      <ul className="flex flex-col divide-y">
        {displayedItems.map((item) => {
          const itemStation = item.station || assignDefaultStation(item.productName);
          const ready = !!item.isItemReady;
          const itemPending = pendingItems.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onToggleItem(item.id)}
                disabled={itemPending}
                aria-pressed={ready}
                aria-busy={itemPending}
                aria-label={
                  ready
                    ? t("ticket.itemReadyAria", { name: item.productName })
                    : t("ticket.itemPendingAria", { name: item.productName })
                }
                className="group flex min-h-11 w-full items-start justify-between gap-2 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <div className={cn("min-w-0", ready && "text-muted-foreground line-through")}>
                  <p className="flex items-center gap-2 text-base font-semibold leading-tight">
                    <span
                      className={cn(
                        "tabular flex size-7 shrink-0 items-center justify-center rounded-md border text-sm",
                        ready
                          ? "border-success/40 bg-success/12 text-foreground"
                          : "bg-muted/40 group-hover:border-primary",
                      )}
                    >
                      {ready ? <Check className="size-4" aria-hidden /> : item.quantity}
                    </span>
                    <span className="truncate">
                      {ready && <span className="tabular">{item.quantity}× </span>}
                      {item.productName}
                    </span>
                  </p>
                  {item.modifiers.length > 0 && (
                    <p className="pl-9 text-sm text-muted-foreground">
                      {item.modifiers.map((m) => m.optionName).join(", ")}
                    </p>
                  )}
                  {item.notes && (
                    <p className="ml-9 mt-0.5 border-l-2 border-warning pl-2 text-sm italic text-foreground">
                      &ldquo;{item.notes}&rdquo;
                    </p>
                  )}
                </div>
                {itemPending ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <Badge variant="neutral" className="shrink-0 px-1.5 py-0 text-[11px]">
                    {t(`stations.${itemStation}`)}
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {order.specialInstructions && (
        <p className="rounded-md bg-muted/60 p-2 text-sm text-foreground">
          {t("ticket.note", { text: order.specialInstructions })}
        </p>
      )}

      {/* Advance Action Button */}
      <Button
        variant={isCompleted ? "outline" : "default"}
        onClick={onAdvance}
        disabled={pending}
        aria-busy={pending}
        className="mt-auto h-11 w-full text-sm font-semibold"
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
        {advanceLabel}
      </Button>
    </article>
  );
}
