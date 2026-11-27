import { useState, useMemo, useEffect, useRef } from "react";
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
  History,
  Utensils,
  ShoppingBag,
  Bike,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/app/workspace-context";
import { usePresentationMode } from "@/components/app/use-presentation-mode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FocusModeButton } from "@/components/app/focus-mode-button";
import { useFocusMode } from "@/lib/focus-mode";
import { cn } from "@/lib/utils";
import { captureError } from "@/lib/observability";
import { Order, OrderStatus, KitchenStation, listOrders } from "@/lib/orders-service";
import {
  calculateElapsedMinutes,
  getTicketUrgency,
  filterOrdersByStation,
  assignDefaultStation,
  formatPlacedAt,
  recentlyCompleted,
  simulateIncomingOrder,
} from "@/lib/kds-service";
import { supabase } from "@/integrations/supabase/client";
import { persistOrderStatusTransition } from "@/lib/orders-persistence-service";
import { fetchKitchenBoard } from "@/lib/recorded-data";
import { createRefreshScheduler } from "@/lib/refresh-scheduler";
import { KitchenCapNotice } from "@/components/kds/kitchen-cap-notice";
import { setOperationalItemReady } from "@/lib/operational.functions";

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

type BoardColumn = "new" | "in_prep" | "ready" | "done";

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
  const { t, i18n } = useTranslation("kds");
  const focus = useFocusMode();
  const { org, orgDbId, locationId, role } = useWorkspace();
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);
  // Every organization — demo-classified ones included — sees persisted tickets only (filled by the
  // fetch below), never browser-local simulated tickets. Those, and the "simulate" button, exist only
  // while presentation mode is explicitly on; simulated tickets are never sent to the server.
  const { active: showcase } = usePresentationMode();
  const [orders, setOrders] = useState<Order[]>(() =>
    showcase ? listOrders(org.id, locationId, locationScope) : [],
  );
  const [stationFilter, setStationFilter] = useState<KitchenStation | "all">("all");
  // Below the lg breakpoint (phones, portrait tablets) one column is shown at a time.
  const [focusColumn, setFocusColumn] = useState<BoardColumn>("new");
  const [nowTick, setNowTick] = useState(Date.now());
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingItems, setPendingItems] = useState<ReadonlySet<string>>(() => new Set());
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("connecting");

  // Open tickets beyond the browser cap (5,000) are announced instead of silently dropped.
  const [boardMeta, setBoardMeta] = useState({ openTotal: 0, openLoaded: 0, truncated: false });
  // Last realtime channel state: restored when a reload succeeds after a failed or timed-out one.
  const realtimeStatusRef = useRef<"connected" | "connecting" | "disconnected">("connecting");
  // Reloads for the current store (set by the effect below; actions await fresh data through it).
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  // Read by the realtime handler without re-subscribing when the sound is toggled.
  const audioAlertsRef = useRef(audioAlerts);
  audioAlertsRef.current = audioAlerts;

  // Board data: every open ticket + the latest delivered ones (fetchKitchenBoard), reloaded on
  // every realtime change and every 15 s as a safety net. Reloads are serialized and bursts are
  // merged (createRefreshScheduler), so an older response never overwrites a newer one. A reload
  // that gets no answer for 20 s is abandoned (its late answer is ignored, it stops requesting
  // pages), the next reload runs and the action buttons are released. Every page that answers
  // restarts the 20 s, so a very large board still loads. A response for a previous store is dropped.
  useEffect(() => {
    let active = true;
    setOrders([]);
    setBoardMeta({ openTotal: 0, openLoaded: 0, truncated: false });
    realtimeStatusRef.current = "connecting";
    setConnectionStatus("connecting");

    const scheduler = createRefreshScheduler(
      async (signal, progress) => {
        try {
          // Each page that answers restarts the 20 s stall deadline (large boards keep loading).
          const board = await fetchKitchenBoard(org.id, locationId, undefined, {
            signal,
            onPage: progress,
          });
          if (!active || signal.aborted) return; // store changed, or abandoned after the deadline
          setOrders(board.orders);
          setBoardMeta({
            openTotal: board.openTotal,
            openLoaded: board.openLoaded,
            truncated: board.truncated,
          });
          // Recovered after a failure/timeout: show the realtime channel's real state again.
          setConnectionStatus(realtimeStatusRef.current);
        } catch (err) {
          if (!active || signal.aborted) return;
          // Keep the tickets already on screen; the badge tells the kitchen the data may be stale.
          setConnectionStatus("disconnected");
          captureError(err, { event: "kds.fetch_failed" });
        }
      },
      {
        onTimeout: () => {
          if (!active) return;
          setConnectionStatus("disconnected");
          captureError(new Error("kitchen board reload timed out"), { event: "kds.fetch_timeout" });
        },
      },
    );
    refreshRef.current = scheduler.now;
    void scheduler.now();

    const interval = setInterval(() => {
      setNowTick(Date.now());
      void scheduler.request();
    }, 15000);

    const channel = supabase
      .channel(`kds-orders-${org.id}-${locationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `org_id=eq.${orgDbId}` },
        (payload) => {
          if (!active) return;
          // Target location check
          const row = payload.new;
          const locDbId = org.locations.find((l) => l.id === locationId)?.dbId;
          if (locationId !== "all" && "location_id" in row && row["location_id"] !== locDbId) {
            return;
          }
          if (payload.eventType === "INSERT" && audioAlertsRef.current) playNewTicketChime();
          void scheduler.request();
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") realtimeStatusRef.current = "connected";
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          realtimeStatusRef.current = "disconnected";
        else return;
        setConnectionStatus(realtimeStatusRef.current);
      });

    return () => {
      active = false;
      scheduler.stop();
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [org.id, locationId]);

  // Leaving presentation mode: reload the board from the server at once, so no simulated ticket
  // stays on screen until the next 15 s refresh.
  const wasShowcase = useRef(showcase);
  useEffect(() => {
    if (wasShowcase.current && !showcase) void refreshRef.current();
    wasShowcase.current = showcase;
  }, [showcase]);

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
      delivered: recentlyCompleted(active, nowTick),
    };
  }, [filteredOrders, nowTick]);

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
      await refreshRef.current();
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
      await refreshRef.current();
    } catch {
      toast.error(t("toast.itemFailed"));
    } finally {
      setPending(setPendingItems, itemId, false);
    }
  };

  const handleSimulateNewOrder = () => {
    if (!showcase) return;
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
    // "Placed at" in the ticket's own store zone (same as Orders), not the device's zone.
    timeZone: org.locations.find((l) => l.id === order.locationId)?.timezone,
    stationFilter,
    pending: pendingOrders.has(order.id),
    pendingItems,
    onToggleItem: (itemId: string) => handleToggleItem(order.id, itemId),
  });

  // Kitchen legibility: the ticket text scales as a whole (em-based), remembered on this device.
  const [textSize, setTextSize] = useState<KdsTextSize>(() => readTextSize());
  const chooseTextSize = (size: KdsTextSize) => {
    setTextSize(size);
    try {
      localStorage.setItem(TEXT_SIZE_KEY, size);
    } catch {
      // Private mode: the choice simply is not remembered.
    }
  };
  const [recallOpen, setRecallOpen] = useState(false);
  const clock = new Intl.DateTimeFormat(i18n.language, {
    hour: "numeric",
    minute: "2-digit",
  }).format(nowTick);
  const lateIn = (list: Order[]) =>
    list.filter((o) => getTicketUrgency(o.createdAt) !== "normal").length;
  const boardColumns = [
    {
      key: "new" as const,
      title: t("columns.new"),
      list: columns.new,
      empty: t("empty.new"),
      next: "in_prep" as const,
      label: t("actions.start"),
      icon: Play,
    },
    {
      key: "in_prep" as const,
      title: t("columns.inPrep"),
      list: columns.in_prep,
      empty: t("empty.inPrep"),
      next: "ready" as const,
      label: t("actions.ready"),
      icon: Check,
    },
    {
      key: "ready" as const,
      title: t("columns.ready"),
      list: columns.ready,
      empty: t("empty.ready"),
      next: "delivered" as const,
      label: t("actions.fulfill"),
      icon: CheckCircle2,
    },
  ];

  return (
    <div
      className={cn(
        "mx-auto flex max-w-[1920px] flex-col gap-3",
        focus.active
          ? "h-[calc(100dvh-1.5rem)] md:h-[calc(100dvh-2rem)]"
          : "md:h-[calc(100dvh-5.5rem)]",
      )}
    >
      {/* Toolbar: what the line needs at a glance, nothing else. */}
      <div className="surface @container flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <CookingPot className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-tight">
              {t("title")}
              <Badge variant={connectionVariant} className="gap-1.5" aria-live="polite">
                <span className={cn("size-1.5 rounded-full", connectionDot)} aria-hidden />
                {t(`connection.${connectionStatus}`)}
              </Badge>
            </h1>
            <p className="tabular mt-0.5 text-sm text-muted-foreground">
              <time>{clock}</time>
              <span aria-hidden> · </span>
              {t("board.open", {
                count: columns.new.length + columns.in_prep.length + columns.ready.length,
              })}
            </p>
          </div>
        </div>

        {/* Station selector: one row that scrolls sideways instead of wrapping. */}
        <div
          role="radiogroup"
          aria-label={t("stationsLabel")}
          className="order-last flex min-w-0 basis-full gap-1 overflow-x-auto rounded-lg border bg-muted/50 p-1 scrollbar-none @[75rem]:order-none @[75rem]:basis-auto @[75rem]:flex-1"
        >
          {STATIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stationFilter === s}
              onClick={() => setStationFilter(s)}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                stationFilter === s
                  ? "raised bg-card text-foreground"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {t(`stations.${s}`)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label={t("textSize.label")}
            className="flex rounded-lg border bg-muted/50 p-1"
          >
            {(["standard", "large"] as const).map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={textSize === size}
                aria-label={t(`textSize.${size}`)}
                title={t(`textSize.${size}`)}
                onClick={() => chooseTextSize(size)}
                className={cn(
                  "flex min-h-11 min-w-11 items-center justify-center rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  size === "standard" ? "text-sm" : "text-lg",
                  textSize === size
                    ? "raised bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                A
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            aria-pressed={audioAlerts}
            onClick={() => setAudioAlerts(!audioAlerts)}
            className={cn("h-12", audioAlerts ? "text-foreground" : "text-muted-foreground")}
          >
            {audioAlerts ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
            <span className="max-sm:sr-only">{audioAlerts ? t("chime.on") : t("chime.off")}</span>
          </Button>
          <Button variant="outline" className="h-12" onClick={() => setRecallOpen(true)}>
            <History aria-hidden />
            <span className="max-sm:sr-only">{t("recall.button")}</span>
            <Badge variant="neutral" className="tabular px-1.5">
              {columns.delivered.length}
            </Badge>
          </Button>
          {showcase && (
            <Button variant="outline" onClick={handleSimulateNewOrder} className="h-12">
              <Sparkles aria-hidden /> {t("simulate")}
            </Button>
          )}
          <FocusModeButton />
        </div>
      </div>

      <KitchenCapNotice
        openLoaded={boardMeta.openLoaded}
        openTotal={boardMeta.openTotal}
        truncated={boardMeta.truncated}
        stationShown={
          stationFilter === "all"
            ? undefined
            : columns.new.length + columns.in_prep.length + columns.ready.length
        }
      />

      {/* The board adapts to its own width (sidebar, focus mode, tablet): three columns when they
          fit, otherwise one column at a time with every count visible. */}
      <div
        className="@container flex flex-col gap-3 md:min-h-0 md:flex-1"
        style={{ fontSize: textSize === "large" ? 18 : 15 }}
      >
        <div
          role="tablist"
          aria-label={t("columnsLabel")}
          className="grid shrink-0 grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1 text-sm @[46rem]:hidden"
        >
          {boardColumns.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={focusColumn === c.key}
              aria-controls={`kds-col-${c.key}`}
              onClick={() => setFocusColumn(c.key)}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-md px-1 font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-1.5",
                focusColumn === c.key
                  ? "raised bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-center">{c.title}</span>
              <span className="tabular font-semibold">{c.list.length}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:min-h-0 md:flex-1 @[46rem]:grid-cols-3">
          {boardColumns.map((c) => (
            <KDSColumn
              key={c.key}
              id={`kds-col-${c.key}`}
              visible={focusColumn === c.key || (focusColumn === "done" && c.key === "new")}
              title={c.title}
              count={c.list.length}
              late={lateIn(c.list)}
              emptyMessage={c.empty}
            >
              {c.list.map((order) => (
                <KDSTicketCard
                  key={order.id}
                  {...cardProps(order)}
                  onAdvance={() => handleStatusChange(order, c.next)}
                  advanceLabel={c.label}
                  advanceIcon={c.icon}
                />
              ))}
            </KDSColumn>
          ))}
        </div>
      </div>

      {/* Recall: tickets completed in the last 2 hours, reopened to the line with one tap. */}
      <Sheet open={recallOpen} onOpenChange={setRecallOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle>{t("columns.done")}</SheetTitle>
            <SheetDescription>{t("recall.description")}</SheetDescription>
          </SheetHeader>
          <div
            className="flex flex-1 flex-col gap-3 overflow-y-auto p-3"
            style={{ fontSize: textSize === "large" ? 18 : 15 }}
          >
            {columns.delivered.length === 0 ? (
              <div className="my-auto flex flex-col items-center p-6 text-center text-sm text-muted-foreground">
                <UtensilsCrossed className="mb-2 size-6 opacity-40" aria-hidden />
                <p>{t("empty.done")}</p>
              </div>
            ) : (
              columns.delivered.map((order) => (
                <KDSTicketCard
                  key={order.id}
                  {...cardProps(order)}
                  onAdvance={() => handleStatusChange(order, "in_prep")}
                  advanceLabel={t("actions.reopen")}
                  advanceIcon={RotateCcw}
                  isCompleted
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

type KdsTextSize = "standard" | "large";
const TEXT_SIZE_KEY = "dinequora.kds.textSize";
function readTextSize(): KdsTextSize {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY) === "large" ? "large" : "standard";
  } catch {
    return "standard";
  }
}

function KDSColumn({
  id,
  visible,
  title,
  count,
  late,
  emptyMessage,
  children,
}: {
  id: string;
  /** Shown in narrow boards only when chosen in the column switcher; always on wide boards. */
  visible: boolean;
  title: string;
  count: number;
  late: number;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("kds");
  return (
    <section
      id={id}
      className={cn(
        "surface h-full min-h-0 flex-col overflow-hidden @[46rem]:flex",
        visible ? "flex" : "hidden",
      )}
      aria-label={title}
    >
      <div className="flex min-h-12 items-center justify-between gap-2 border-b bg-muted/40 px-3.5 py-2">
        <h2 className="flex items-center gap-2 text-[1em] font-semibold">
          {title}
          <span className="tabular rounded-md bg-card px-1.5 py-0.5 text-[0.8em] font-semibold shadow-xs">
            {count}
          </span>
        </h2>
        {late > 0 && (
          <span className="tabular inline-flex items-center gap-1 text-[0.8em] font-semibold text-destructive">
            <AlertTriangle className="size-[1.1em]" aria-hidden />
            {t("board.late", { count: late })}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3 scrollbar-thin md:overflow-y-auto">
        {count === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center p-6 text-center text-[0.9em] text-muted-foreground">
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

const ORDER_TYPE_ICON = { dine_in: Utensils, takeout: ShoppingBag, delivery: Bike } as const;

function KDSTicketCard({
  order,
  timeZone,
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
  /** IANA zone of the ticket's store; "Placed at" is shown in it. */
  timeZone?: string | undefined;
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
  const placedAt = formatPlacedAt(order.createdAt, i18n.language, timeZone);
  const fresh = !isCompleted && elapsed < 1;
  const TypeIcon = ORDER_TYPE_ICON[order.type as keyof typeof ORDER_TYPE_ICON] ?? Utensils;
  const who = order.customer.tableNumber
    ? t("ticket.table", { table: order.customer.tableNumber })
    : order.customer.name;

  const displayedItems = order.items.filter((item) => {
    if (stationFilter === "all") return true;
    return (item.station || assignDefaultStation(item.productName)) === stationFilter;
  });

  return (
    <article
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs motion-safe:animate-enter",
        urgency === "warning" && "border-warning/60 ring-1 ring-warning/40",
        urgency === "delayed" && "border-destructive/70 ring-2 ring-destructive/50",
        fresh && "ring-2 ring-primary/50",
        isCompleted && "opacity-80",
      )}
    >
      {/* Header: number, who, how long — readable from across the line. */}
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-b px-3.5 py-2.5",
          urgency === "delayed"
            ? "bg-destructive/10"
            : urgency === "warning"
              ? "bg-warning/12"
              : "bg-muted/40",
        )}
      >
        <div className="min-w-0">
          <p className="tabular text-[1.4em] font-bold leading-none tracking-tight">
            {order.orderNumber}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.85em] text-muted-foreground">
            <TypeIcon className="size-[1.05em]" aria-hidden />
            <span className="font-medium text-foreground">{t(`orderType.${order.type}`)}</span>
            {who && (
              <>
                <span aria-hidden>·</span>
                <span className="break-words font-medium text-foreground">{who}</span>
              </>
            )}
            {fresh && (
              <span className="rounded-full bg-primary px-1.5 py-px text-[0.8em] font-semibold text-primary-foreground">
                {t("board.fresh")}
              </span>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 text-right">
          <span
            className={cn(
              "tabular inline-flex items-center gap-1 rounded-md px-2 py-1 text-[1em] font-bold leading-none",
              urgency === "delayed" && "bg-destructive text-destructive-foreground",
              urgency === "warning" && "bg-warning text-white",
              urgency === "normal" && "border bg-card text-foreground",
            )}
            title={t("age.waiting", { age })}
          >
            {urgency === "normal" ? (
              <Clock className="size-[1em]" aria-hidden />
            ) : (
              <AlertTriangle className="size-[1em]" aria-hidden />
            )}
            {age}
          </span>
          {urgency !== "normal" && (
            <span
              className={cn(
                "text-[0.75em] font-bold uppercase tracking-wide",
                urgency === "delayed" ? "text-destructive" : "text-warning",
              )}
            >
              {urgency === "delayed" ? t("age.overdue") : t("age.late")}
            </span>
          )}
          <span className="tabular text-[0.75em] text-muted-foreground">
            {t("ticket.placedAt", { time: placedAt })}
          </span>
        </div>
      </header>

      {/* Items: tap a line when it is done (full names, never cut). */}
      <ul className="flex flex-col divide-y px-2">
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
                className="group flex min-h-12 w-full items-start gap-3 rounded-md px-1.5 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span
                  className={cn(
                    "tabular flex size-[2.1em] shrink-0 items-center justify-center rounded-md border text-[1em] font-bold",
                    ready
                      ? "border-success/50 bg-success/12 text-success"
                      : "bg-muted/50 group-hover:border-primary",
                  )}
                >
                  {ready ? <Check className="size-[1.1em]" aria-hidden /> : item.quantity}
                </span>
                <span className={cn("min-w-0 flex-1", ready && "text-muted-foreground")}>
                  <span
                    className={cn(
                      "block break-words text-[1.07em] font-semibold leading-snug",
                      ready && "line-through",
                    )}
                  >
                    {ready && <span className="tabular">{item.quantity}× </span>}
                    {item.productName}
                  </span>
                  {item.modifiers.length > 0 && (
                    <span className="mt-0.5 block text-[0.93em] text-muted-foreground">
                      {item.modifiers.map((m) => m.optionName).join(" · ")}
                    </span>
                  )}
                  {item.notes && (
                    <span className="mt-1 block rounded-md border-l-[3px] border-warning bg-warning/10 px-2 py-1 text-[0.93em] font-medium italic text-foreground">
                      &ldquo;{item.notes}&rdquo;
                    </span>
                  )}
                  {stationFilter === "all" && (
                    <span className="mt-1 block text-[0.72em] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`stations.${itemStation}`)}
                    </span>
                  )}
                </span>
                {itemPending && (
                  <Loader2
                    className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {order.specialInstructions && (
        <p className="mx-3 mb-1 rounded-md border-l-[3px] border-warning bg-warning/10 px-2.5 py-2 text-[0.93em] font-medium text-foreground">
          {t("ticket.note", { text: order.specialInstructions })}
        </p>
      )}

      {/* Bump: one large target at the bottom of every ticket. */}
      <div className="mt-auto p-3 pt-2">
        <Button
          variant={isCompleted ? "outline" : "default"}
          onClick={onAdvance}
          disabled={pending}
          aria-busy={pending}
          className="h-14 w-full text-[1em] font-semibold"
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
          {advanceLabel}
        </Button>
      </div>
    </article>
  );
}
