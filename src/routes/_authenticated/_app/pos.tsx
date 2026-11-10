import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  PlayCircle,
  Banknote,
  CreditCard,
  Smartphone,
  Receipt,
  XCircle,
  Tag,
  Printer,
  Loader2,
  UtensilsCrossed,
  AlertTriangle,
  Check,
} from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { DemoBadge, OrgLogo } from "@/components/app/brand-mark";
import { EmptyState, Skeleton } from "@/components/app/states";
import { type MenuItem, type ModifierOption } from "@/lib/menu-service";
import { fetchOperationalMenu } from "@/lib/operational.functions";
import {
  getPOSSession,
  addItemToCart,
  updateCartItemQuantity,
  removeItemFromCart,
  applyDiscount,
  setOrderType,
  setCustomerInfo,
  suspendSession,
  resumeSession,
  simulatePayment,
  posTaxRateBasisPoints,
  type POSPaymentMethod,
  type POSSession,
} from "@/lib/pos-service";
import {
  persistFinalizedPOSSaleAtomic,
  cancelOrderWithReversal,
} from "@/lib/orders-persistence-service";
import { confirmedReceipt } from "@/lib/pos-receipt";
import { type OrderType } from "@/lib/orders-service";
import { fmtBasisPoints, fmtMoneyCents } from "@/lib/format";
import { captureError, isExpectedBusinessError } from "@/lib/observability";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { centsFromNumberInput, centsToDecimalString } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/_app/pos")({
  head: () => ({
    meta: [
      { title: "POS · Dinequora" },
      {
        name: "description",
        content: "Authorized point of sale and server-confirmed restaurant orders.",
      },
      { property: "og:title", content: "POS · Dinequora" },
      {
        property: "og:description",
        content: "Authorized point of sale and server-confirmed restaurant orders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: POSPage,
});

const ORDER_TYPES: OrderType[] = ["dine_in", "takeout", "delivery"];
const PAYMENT_METHODS: { id: POSPaymentMethod; icon: typeof Banknote }[] = [
  { id: "cash", icon: Banknote },
  { id: "card", icon: CreditCard },
  { id: "digital", icon: Smartphone },
];

type MenuCategoryOption = { id: string; name: string };
type MenuLoadState = "loading" | "ready" | "error";
type ReceiptRecord = POSSession & {
  persistedOrderId: string;
  orderNumber: string;
  isSimulation: boolean;
};

/** DB order numbers already start with "#"; only the id fallback needs a prefix. */
function displayOrderNumber(orderNumber: string | undefined, orderId: string): string {
  const raw = (orderNumber || orderId.slice(0, 8).toUpperCase()).trim();
  return raw.startsWith("#") ? raw : `#${raw}`;
}

/** Human-readable backend detail, or undefined for technical error codes. */
function readableDetail(err: unknown): string | undefined {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || /^[a-z0-9_.:-]+$/i.test(msg)) return undefined;
  return msg;
}

// Tendered and discount are <input type="number"> values ("." decimal, exact conversion to
// cents: "9.995" is $10.00, never $9,995). Empty or unreadable means nothing entered yet: the
// sale stays blocked (cash short / no discount) instead of recording a guessed amount.
const parseAmountCents = (value: string) => centsFromNumberInput(value) ?? 0;

export function POSPage() {
  const { t, i18n } = useTranslation("pos");
  const lng = i18n.language;
  const money = (cents: number) => fmtMoneyCents(cents, lng);
  const { org, locationId, user, role, can } = useWorkspace();
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);
  const activeLocId = locationId === "all" ? org.locations[0]?.id || "loc-1" : locationId;
  // Data only; the translated fallback is applied at render time so a language switch never resets the cart.
  const cashierName = user.fullName || user.email || "";

  const [session, setSession] = useState(() =>
    getPOSSession(org.id, activeLocId, cashierName, locationScope),
  );
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [modModalItem, setModModalItem] = useState<MenuItem | null>(null);
  const [selectedMods, setSelectedMods] = useState<Record<string, ModifierOption[]>>({});
  const [itemNotes, setItemNotes] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<POSPaymentMethod>("cash");
  const [tenderedInput, setTenderedInput] = useState("");
  const [receiptSession, setReceiptSession] = useState<ReceiptRecord | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingSale, setCancellingSale] = useState(false);
  const [submittingSale, setSubmittingSale] = useState(false);

  useEffect(() => {
    setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
  }, [org.id, activeLocId, cashierName]);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<MenuCategoryOption[]>([]);
  const [menuState, setMenuState] = useState<MenuLoadState>("loading");
  const [menuReload, setMenuReload] = useState(0);
  useEffect(() => {
    let active = true;
    setMenuItems([]);
    setMenuCategories([]);
    setSelectedCat("all");
    setMenuState("loading");
    fetchOperationalMenu({ data: { orgId: org.id } })
      .then((data) => {
        if (!active) return;
        setMenuItems(
          data.items.filter(
            (i) => i.active && (i.locationIds.length === 0 || i.locationIds.includes(activeLocId)),
          ),
        );
        setMenuCategories(data.categories.map((c) => ({ id: c.id, name: c.name })));
        setMenuState("ready");
      })
      .catch(() => {
        // The catalogue area renders the failure with a retry action (no silent empty grid).
        if (active) setMenuState("error");
      });
    return () => {
      active = false;
    };
  }, [org.id, activeLocId, menuReload]);

  // Category chips show the stored category name (never the client_id), only for categories that
  // have sellable items here, in the active language's alphabetical order.
  const categories = useMemo(() => {
    const used = new Set(menuItems.map((m) => m.category));
    return menuCategories
      .filter((c) => used.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, lng, { sensitivity: "base" }));
  }, [menuItems, menuCategories, lng]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((i) => {
      const matchCat = selectedCat === "all" || i.category === selectedCat;
      const matchSearch =
        !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedCat, search]);

  // Reserve the photo slot on every tile only when the menu actually has photos, so the grid stays
  // uniform with photos and dense without them.
  const menuHasImages = useMemo(() => menuItems.some((i) => !!i.imageUrl), [menuItems]);

  const taxRateLabel = fmtBasisPoints(posTaxRateBasisPoints(session), lng);
  const displayCashier = session.cashierName || t("ticket.cashierFallback");
  const ticketCount = session.cart.reduce((n, item) => n + item.quantity, 0);

  const handleOpenItem = (item: MenuItem) => {
    if (item.modifierGroups && item.modifierGroups.length > 0) {
      setModModalItem(item);
      setSelectedMods({});
      setItemNotes("");
    } else {
      const updated = addItemToCart(session, item, [], 1);
      setSession(updated);
      toast.success(t("toast.added", { name: item.name }));
    }
  };

  const toggleModifier = (groupId: string, option: ModifierOption, max: number) => {
    setSelectedMods((prev) => {
      const current = prev[groupId] ?? [];
      const exists = current.some((o) => o.id === option.id);
      let next: ModifierOption[];
      if (exists) next = current.filter((o) => o.id !== option.id);
      else if (max <= 1) next = [option];
      else if (current.length >= max) next = current;
      else next = [...current, option];
      return { ...prev, [groupId]: next };
    });
  };

  const handleConfirmModifiers = () => {
    if (!modModalItem) return;
    const missingRequired = modModalItem.modifierGroups?.filter(
      (g) => g.required && (selectedMods[g.id]?.length ?? 0) === 0,
    );
    if (missingRequired && missingRequired.length > 0) {
      toast.error(t("modifiers.requiredMissing"));
      return;
    }
    const flatMods = Object.entries(selectedMods).flatMap(([groupId, opts]) => {
      const group = modModalItem.modifierGroups?.find((g) => g.id === groupId);
      return opts.map((opt) => ({
        groupId,
        groupName: group?.name || "",
        optionId: opt.id,
        optionName: opt.name,
        priceCents: opt.priceCents,
      }));
    });
    const updated = addItemToCart(
      session,
      modModalItem,
      flatMods,
      1,
      itemNotes.trim() || undefined,
    );
    setSession(updated);
    setModModalItem(null);
    toast.success(t("toast.added", { name: modModalItem.name }));
  };

  const handleQuantity = (cartItemId: string, delta: number) => {
    const itm = session.cart.find((c) => c.id === cartItemId);
    if (!itm) return;
    const nextQty = itm.quantity + delta;
    const updated =
      nextQty <= 0
        ? removeItemFromCart(session, cartItemId)
        : updateCartItemQuantity(session, cartItemId, nextQty);
    setSession(updated);
  };

  const handleClearTicket = () => {
    if (session.cart.length === 0) return;
    setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
    setClearConfirmOpen(false);
    toast.info(t("toast.cleared"));
  };

  const handleApplyDiscountSubmit = () => {
    const updated = applyDiscount(session, parseAmountCents(discountInput || "0"));
    setSession(updated);
    setDiscountModalOpen(false);
    toast.success(t("toast.discountApplied"));
  };

  const handleSuspend = () => {
    if (session.cart.length === 0) return;
    suspendSession(session, locationScope);
    toast.info(t("toast.held"));
    setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
  };

  const handleResume = (id: string) => {
    const resumed = resumeSession(org.id, id, locationScope);
    if (resumed) {
      setSession(resumed);
      toast.success(t("toast.resumed"));
    }
  };

  const handleStartCheckout = () => {
    if (session.cart.length === 0 || submittingSale) return;
    setTenderedInput(centsToDecimalString(session.totalCents));
    setCheckoutOpen(true);
  };

  const tenderedCents = parseAmountCents(tenderedInput || "0");
  const cashShort = payMethod === "cash" && tenderedCents < session.totalCents;

  const handleCompleteSale = async () => {
    if (submittingSale) return;
    const paid = simulatePayment(session, payMethod, tenderedCents);
    if (payMethod === "cash" && tenderedCents < paid.totalCents) {
      toast.error(t("checkout.insufficient"));
      return;
    }
    setSubmittingSale(true);
    try {
      const idemKey = `pos-tx-${session.id || Date.now()}`;
      const persistRes = await persistFinalizedPOSSaleAtomic(paid, idemKey);
      if (!persistRes.success || !persistRes.orderId) {
        throw new Error(persistRes.error || "sale_not_confirmed");
      }

      const orderNumber = displayOrderNumber(persistRes.orderNumber, persistRes.orderId);
      setReceiptSession({
        ...confirmedReceipt(paid, persistRes),
        persistedOrderId: persistRes.orderId,
        orderNumber,
      });
      setCheckoutOpen(false);
      // Only reset active cart once server confirmed sale ID
      setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
      toast.success(t("toast.saleRecorded", { number: orderNumber }));
    } catch (err) {
      captureError(err, {
        event: "pos.sale_failed",
        critical: !isExpectedBusinessError(err),
        storeId: activeLocId,
      });
      const detail = readableDetail(err);
      toast.error(t("toast.saleFailed"), detail ? { description: detail } : undefined);
    } finally {
      setSubmittingSale(false);
    }
  };

  const handleCancelPersistedSale = async () => {
    if (!receiptSession?.persistedOrderId || cancellingSale) return;
    const reason = cancelReason.trim() || t("cancelDialog.defaultReason");
    setCancellingSale(true);
    try {
      const res = await cancelOrderWithReversal(receiptSession.persistedOrderId, reason);
      if (!res.success) {
        throw new Error(res.error || "cancel_failed");
      }
      if (res.alreadyCancelled) {
        toast.info(t("toast.alreadyCancelled"));
      } else {
        toast.success(t("toast.cancelled"));
      }
      setCancelModalOpen(false);
      setReceiptSession(null);
      setCancelReason("");
    } catch (err) {
      captureError(err, {
        event: "pos.cancel_failed",
        critical: !isExpectedBusinessError(err),
        storeId: activeLocId,
      });
      const detail = readableDetail(err);
      toast.error(t("toast.cancelFailed"), detail ? { description: detail } : undefined);
    } finally {
      setCancellingSale(false);
    }
  };

  const changeDueCents = receiptSession
    ? Math.max(
        0,
        (receiptSession.tenderedCents ?? receiptSession.totalCents) - receiptSession.totalCents,
      )
    : 0;

  const modalBaseCents = modModalItem
    ? modModalItem.priceCents +
      Object.values(selectedMods)
        .flat()
        .reduce((acc, o) => acc + o.priceCents, 0)
    : 0;

  const filtersActive = search.trim() !== "" || selectedCat !== "all";

  return (
    <div className="flex flex-col gap-4 pb-16 lg:h-[calc(100vh-5rem)] lg:flex-row lg:overflow-hidden lg:pb-0">
      {/* Main Catalog View */}
      <section className="surface flex min-h-[60vh] flex-1 flex-col overflow-hidden lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-9"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {org.fictional && <DemoBadge label={t("simulatedBadge")} />}
            {session.suspendedSessions.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="eyebrow hidden text-muted-foreground sm:inline">
                  {t("held.label")}
                </span>
                {session.suspendedSessions.map((s) => {
                  const name = s.customerName || t("held.untitled");
                  return (
                    <Button
                      key={s.id}
                      variant="outline"
                      onClick={() => handleResume(s.id)}
                      aria-label={t("held.resumeAria", { name })}
                      className="h-11 shrink-0 px-3 text-xs"
                    >
                      <PlayCircle aria-hidden /> {name}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Category chips */}
        {categories.length > 0 && (
          <div
            role="radiogroup"
            aria-label={t("categoriesLabel")}
            className="flex gap-2 overflow-x-auto border-b p-2 scrollbar-none"
          >
            {[{ id: "all", name: t("allCategories") }, ...categories].map((c) => (
              <Button
                key={c.id}
                role="radio"
                aria-checked={selectedCat === c.id}
                variant={selectedCat === c.id ? "secondary" : "ghost"}
                onClick={() => setSelectedCat(c.id)}
                className={cn(
                  "h-11 shrink-0 px-4 text-sm",
                  selectedCat === c.id
                    ? "border border-foreground/15 font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {menuState === "loading" ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
              aria-busy="true"
              aria-label={t("menu.loading")}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : menuState === "error" ? (
            <EmptyState
              icon={<AlertTriangle className="size-5" aria-hidden />}
              title={t("menu.errorTitle")}
              body={t("menu.errorBody")}
              action={
                <Button variant="outline" onClick={() => setMenuReload((n) => n + 1)}>
                  {t("menu.retry")}
                </Button>
              }
            />
          ) : menuItems.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="size-5" aria-hidden />}
              title={t("menu.emptyTitle")}
              body={t("menu.emptyBody")}
            />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              icon={<Search className="size-5" aria-hidden />}
              title={t("menu.noMatchesTitle")}
              body={t("menu.noMatchesBody")}
              action={
                filtersActive ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setSelectedCat("all");
                    }}
                  >
                    {t("menu.clearFilters")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenItem(item)}
                  aria-label={t("addItemAria", { name: item.name, price: money(item.priceCents) })}
                  className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                >
                  {menuHasImages &&
                    (item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/3] w-full border-b bg-muted object-cover"
                      />
                    ) : (
                      <div
                        className="flex aspect-[4/3] w-full items-center justify-center border-b bg-muted"
                        aria-hidden
                      >
                        <UtensilsCrossed className="size-6 text-muted-foreground/50" />
                      </div>
                    ))}
                  <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                    <div>
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{item.name}</p>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="tabular text-sm font-semibold">
                        {money(item.priceCents)}
                      </span>
                      <Plus
                        className="size-4 text-muted-foreground group-hover:text-primary"
                        aria-hidden
                      />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Right Cart Sidebar */}
      <aside
        id="pos-ticket"
        className="surface flex w-full shrink-0 scroll-mt-4 flex-col overflow-hidden lg:w-96"
      >
        {/* Header Order Settings */}
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{t("ticket.title")}</h2>
            <span className="truncate text-xs text-muted-foreground">
              {t("ticket.attendant", { name: displayCashier })}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label={t("ticket.orderTypeLabel")}
            className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-1"
          >
            {ORDER_TYPES.map((tType) => (
              <button
                key={tType}
                type="button"
                role="radio"
                aria-checked={session.orderType === tType}
                onClick={() => setSession(setOrderType(session, tType))}
                className={cn(
                  "h-11 rounded-[5px] px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  session.orderType === tType
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`orderType.${tType}`)}
              </button>
            ))}
          </div>
          <Input
            aria-label={t("ticket.customerLabel")}
            placeholder={t("ticket.customerPlaceholder")}
            value={session.customerName ?? ""}
            onChange={(e) => setSession(setCustomerInfo(session, e.target.value))}
            className="h-11 text-sm"
          />
        </div>

        {/* Cart Item List */}
        <div className="flex flex-1 flex-col divide-y overflow-y-auto px-3">
          {session.cart.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-snug">{item.productName}</p>
                {item.modifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {item.modifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                {item.notes && (
                  <p className="text-xs italic text-muted-foreground">&ldquo;{item.notes}&rdquo;</p>
                )}
                <p className="tabular mt-0.5 text-sm font-semibold">{money(item.subtotalCents)}</p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  size="icon"
                  variant="outline"
                  className="size-11"
                  aria-label={t("ticket.decreaseAria", { name: item.productName })}
                  onClick={() => handleQuantity(item.id, -1)}
                >
                  <Minus aria-hidden />
                </Button>
                <span className="tabular w-8 text-center text-sm font-semibold" aria-live="polite">
                  {item.quantity}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-11"
                  aria-label={t("ticket.increaseAria", { name: item.productName })}
                  onClick={() => handleQuantity(item.id, 1)}
                >
                  <Plus aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-1 size-11 text-muted-foreground hover:text-destructive"
                  aria-label={t("ticket.removeAria", { name: item.productName })}
                  onClick={() => setSession(removeItemFromCart(session, item.id))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
          ))}
          {session.cart.length === 0 && (
            <div className="my-auto flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
              <ShoppingBag className="mb-2 size-8 opacity-40" aria-hidden />
              <p>{t("ticket.empty")}</p>
            </div>
          )}
        </div>

        {/* Totals & Actions Footer */}
        <div className="flex flex-col gap-3 border-t p-3">
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <dt>{t("totals.subtotal")}</dt>
              <dd className="tabular">{money(session.subtotalCents)}</dd>
            </div>
            {session.discountCents > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>{t("totals.discount")}</dt>
                <dd className="tabular">−{money(session.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <dt>{t("totals.tax", { rate: taxRateLabel })}</dt>
              <dd className="tabular">{money(session.taxCents)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t pt-2 text-lg font-semibold text-foreground">
              <dt>{t("totals.total")}</dt>
              <dd className="tabular">{money(session.totalCents)}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              onClick={() => setDiscountModalOpen(true)}
              disabled={session.cart.length === 0 || !can("pos.discount")}
              className="h-11 px-2 text-xs"
            >
              <Tag aria-hidden /> {t("actions.discount")}
            </Button>
            <Button
              variant="outline"
              onClick={handleSuspend}
              disabled={session.cart.length === 0}
              className="h-11 px-2 text-xs"
            >
              <PlayCircle aria-hidden /> {t("actions.hold")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(true)}
              disabled={session.cart.length === 0}
              className="h-11 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <XCircle aria-hidden /> {t("actions.clear")}
            </Button>
          </div>

          <Button
            className="tabular h-12 w-full text-base font-semibold"
            onClick={handleStartCheckout}
            disabled={session.cart.length === 0 || submittingSale}
            aria-busy={submittingSale}
          >
            {submittingSale ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CreditCard aria-hidden />
            )}
            {t("actions.charge", { amount: money(session.totalCents) })}
          </Button>
        </div>
      </aside>

      {/* Modifier Dialog */}
      <Dialog open={!!modModalItem} onOpenChange={(open) => !open && setModModalItem(null)}>
        <DialogContent className="max-w-md">
          {modModalItem && (
            <>
              <DialogHeader>
                <DialogTitle>{modModalItem.name}</DialogTitle>
                {modModalItem.description && (
                  <DialogDescription>{modModalItem.description}</DialogDescription>
                )}
              </DialogHeader>
              <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto py-1">
                {modModalItem.modifierGroups.map((g) => {
                  const chosen = selectedMods[g.id] ?? [];
                  const max = Math.max(1, g.maxSelections || 1);
                  return (
                    <fieldset key={g.id} className="flex flex-col gap-2">
                      <legend className="mb-2 flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{g.name}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {t("modifiers.upTo", { count: max })}
                          </span>
                          <Badge variant={g.required ? "warning" : "neutral"}>
                            {g.required ? t("modifiers.required") : t("modifiers.optional")}
                          </Badge>
                        </span>
                      </legend>
                      <div className="grid grid-cols-2 gap-2">
                        {g.options.map((opt) => {
                          const isOn = chosen.some((o) => o.id === opt.id);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={isOn}
                              onClick={() => toggleModifier(g.id, opt, max)}
                              className={cn(
                                "flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isOn
                                  ? "border-primary bg-primary-soft font-medium text-foreground"
                                  : "hover:bg-accent",
                              )}
                            >
                              <span className="flex items-center gap-1.5">
                                {isOn && <Check className="size-4 text-primary" aria-hidden />}
                                {opt.name}
                              </span>
                              {opt.priceCents > 0 && (
                                <span className="tabular text-xs text-muted-foreground">
                                  +{money(opt.priceCents)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="pos-item-notes"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("modifiers.notesLabel")}
                  </label>
                  <Input
                    id="pos-item-notes"
                    placeholder={t("modifiers.notesPlaceholder")}
                    value={itemNotes}
                    onChange={(e) => setItemNotes(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setModModalItem(null)}>
                  {t("actions.cancel")}
                </Button>
                <Button className="tabular h-11" onClick={handleConfirmModifiers}>
                  {t("actions.addToTicket")} · {money(modalBaseCents)}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Checkout Dialog */}
      <Dialog
        open={checkoutOpen}
        onOpenChange={(open) => {
          if (!submittingSale) setCheckoutOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="tabular">
              {t("checkout.title", { amount: money(session.totalCents) })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div
              role="radiogroup"
              aria-label={t("checkout.methodLabel")}
              className="grid grid-cols-3 gap-2"
            >
              {PAYMENT_METHODS.map(({ id, icon: Icon }) => (
                <Button
                  key={id}
                  role="radio"
                  aria-checked={payMethod === id}
                  variant="outline"
                  disabled={submittingSale}
                  onClick={() => setPayMethod(id)}
                  className={cn(
                    "h-16 flex-col gap-1 whitespace-normal",
                    payMethod === id && "border-primary bg-primary-soft text-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="text-xs">{t(`methods.${id}`)}</span>
                </Button>
              ))}
            </div>

            {payMethod === "cash" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pos-tendered" className="text-xs font-medium text-muted-foreground">
                  {t("checkout.tenderedLabel")}
                </label>
                <Input
                  id="pos-tendered"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={tenderedInput}
                  disabled={submittingSale}
                  onChange={(e) => setTenderedInput(e.target.value)}
                  aria-invalid={cashShort}
                  aria-describedby="pos-tendered-hint"
                  className="tabular h-11"
                />
                <p id="pos-tendered-hint" className="text-sm" aria-live="polite">
                  {cashShort ? (
                    <span className="text-destructive">{t("checkout.insufficient")}</span>
                  ) : tenderedCents > session.totalCents ? (
                    <span className="tabular font-semibold text-foreground">
                      {t("checkout.change", { amount: money(tenderedCents - session.totalCents) })}
                    </span>
                  ) : null}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11"
              disabled={submittingSale}
              onClick={() => setCheckoutOpen(false)}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="h-11"
              disabled={submittingSale || cashShort}
              aria-busy={submittingSale}
              onClick={handleCompleteSale}
            >
              {submittingSale && <Loader2 className="animate-spin" aria-hidden />}
              {submittingSale ? t("checkout.confirming") : t("checkout.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discount Modal */}
      <Dialog open={discountModalOpen} onOpenChange={setDiscountModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("discountDialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <label htmlFor="pos-discount" className="text-xs font-medium text-muted-foreground">
              {t("discountDialog.amountLabel")}
            </label>
            <Input
              id="pos-discount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="tabular h-11"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setDiscountModalOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button className="h-11" onClick={handleApplyDiscountSubmit}>
              {t("actions.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phones and tablets: the ticket sits below the menu, so keep its summary in reach */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t bg-card/95 px-4 py-2 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="tabular min-w-0 truncate text-sm font-medium" aria-live="polite">
            {ticketCount > 0
              ? t("ticket.mobileSummary", { count: ticketCount, total: money(session.totalCents) })
              : t("ticket.mobileEmpty")}
          </p>
          <Button
            size="sm"
            variant={ticketCount > 0 ? "default" : "outline"}
            className="h-10 shrink-0"
            onClick={() =>
              document
                .getElementById("pos-ticket")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <ShoppingBag className="mr-1.5 size-4" aria-hidden />
            {t("ticket.view")}
          </Button>
        </div>
      </div>

      {/* Clear ticket confirmation */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clearDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clearDialog.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("actions.back")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearTicket}
            >
              {t("clearDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Receipt Modal */}
      <Dialog open={!!receiptSession} onOpenChange={(open) => !open && setReceiptSession(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Receipt className="size-4" aria-hidden /> {t("receipt.dialogTitle")}
            </DialogTitle>
          </DialogHeader>
          {receiptSession && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="flex flex-col items-center gap-1 border-b pb-3 text-center">
                <OrgLogo logoUrl={org.logoUrl} initials={org.initials} className="size-10" />
                <p className="text-[15px] font-semibold">{org.name}</p>
                <p className="eyebrow text-muted-foreground">
                  {receiptSession.isSimulation ? t("receipt.simulationTitle") : t("receipt.title")}
                </p>
                {receiptSession.isSimulation && (
                  <DemoBadge label={t("receipt.simulationNote")} className="mt-1" />
                )}
                <p className="mt-1 font-mono text-sm font-semibold">
                  {t("receipt.order", { number: receiptSession.orderNumber })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("receipt.cashier", {
                    name: receiptSession.cashierName || t("ticket.cashierFallback"),
                  })}{" "}
                  · {t(`orderType.${receiptSession.orderType}`)}
                </p>
                {receiptSession.customerName && (
                  <p className="text-xs text-muted-foreground">
                    {t("receipt.customer", { name: receiptSession.customerName })}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1 border-b pb-2">
                {receiptSession.cart.map((c) => (
                  <div key={c.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="tabular">{c.quantity}×</span> {c.productName}
                    </span>
                    <span className="tabular shrink-0">{money(c.subtotalCents)}</span>
                  </div>
                ))}
              </div>
              <dl className="flex flex-col gap-0.5">
                <div className="flex justify-between text-muted-foreground">
                  <dt>{t("receipt.subtotal")}</dt>
                  <dd className="tabular">{money(receiptSession.subtotalCents)}</dd>
                </div>
                {receiptSession.discountCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>{t("receipt.discount")}</dt>
                    <dd className="tabular">−{money(receiptSession.discountCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <dt>
                    {t("receipt.tax", {
                      rate: fmtBasisPoints(posTaxRateBasisPoints(receiptSession), lng),
                    })}
                  </dt>
                  <dd className="tabular">{money(receiptSession.taxCents)}</dd>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1.5 font-semibold">
                  <dt>{t("receipt.total")}</dt>
                  <dd className="tabular">{money(receiptSession.totalCents)}</dd>
                </div>
                <div className="flex justify-between pt-1 text-xs text-muted-foreground">
                  <dt>{t("receipt.method")}</dt>
                  <dd>{t(`methods.${receiptSession.paymentMethod ?? "cash"}`)}</dd>
                </div>
                {receiptSession.paymentMethod === "cash" && (
                  <div className="flex justify-between text-xs font-semibold">
                    <dt>{t("receipt.change")}</dt>
                    <dd className="tabular">{money(changeDueCents)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {receiptSession?.persistedOrderId && can("orders.refund") && (
              <Button
                variant="outline"
                onClick={() => setCancelModalOpen(true)}
                className="h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto sm:w-auto"
              >
                <XCircle aria-hidden /> {t("receipt.refund")}
              </Button>
            )}
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button variant="outline" className="h-11" onClick={() => window.print()}>
                <Printer aria-hidden /> {t("actions.print")}
              </Button>
              <Button className="h-11" onClick={() => setReceiptSession(null)}>
                {t("actions.close")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={cancelModalOpen}
        onOpenChange={(open) => {
          if (!cancellingSale) setCancelModalOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <XCircle className="size-4 text-destructive" aria-hidden /> {t("cancelDialog.title")}
            </DialogTitle>
            <DialogDescription>{t("cancelDialog.body")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-2">
            <label htmlFor="pos-cancel-reason" className="text-xs font-medium text-foreground">
              {t("cancelDialog.reasonLabel")}
            </label>
            <Input
              id="pos-cancel-reason"
              placeholder={t("cancelDialog.reasonPlaceholder")}
              value={cancelReason}
              disabled={cancellingSale}
              onChange={(e) => setCancelReason(e.target.value)}
              className="h-11"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11"
              disabled={cancellingSale}
              onClick={() => setCancelModalOpen(false)}
            >
              {t("actions.back")}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              disabled={cancellingSale}
              aria-busy={cancellingSale}
              onClick={handleCancelPersistedSale}
            >
              {cancellingSale && <Loader2 className="animate-spin" aria-hidden />}
              {cancellingSale ? t("cancelDialog.confirming") : t("cancelDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
