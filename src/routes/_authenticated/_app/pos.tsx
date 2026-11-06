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
  DollarSign,
  CreditCard,
  Smartphone,
  Receipt,
  XCircle,
  Tag,
  Printer,
} from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { listMenuItems, type MenuItem, type ModifierOption } from "@/lib/menu-service";
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
  type POSPaymentMethod,
  type POSCartItem,
} from "@/lib/pos-service";
import {
  persistFinalizedPOSSaleAtomic,
  cancelOrderWithReversal,
} from "@/lib/orders-persistence-service";
import { type OrderType } from "@/lib/orders-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_app/pos")({
  head: () => ({
    meta: [
      { title: "POS · Servora" },
      {
        name: "description",
        content: "Authorized point of sale and server-confirmed restaurant orders.",
      },
      { property: "og:title", content: "POS · Servora" },
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

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function POSPage() {
  const { t } = useTranslation("orders");
  const { org, locationId, user, role } = useWorkspace();
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);
  const activeLocId = locationId === "all" ? org.locations[0]?.id || "loc-1" : locationId;
  const cashierName = user.fullName || user.email || "Cashier";

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
  const [payMethod, setPayMethod] = useState<POSPaymentMethod>("cash");
  const [tenderedInput, setTenderedInput] = useState("");
  const [receiptSession, setReceiptSession] = useState<
    (typeof session & { persistedOrderId?: string }) | null
  >(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingSale, setCancellingSale] = useState(false);

  useEffect(() => {
    setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
  }, [org.id, activeLocId, cashierName]);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  useEffect(() => {
    let active = true;
    setMenuItems([]);
    fetchOperationalMenu({ data: { orgId: org.id } })
      .then((data) => {
        if (active)
          setMenuItems(
            data.items.filter(
              (i) =>
                i.active && (i.locationIds.length === 0 || i.locationIds.includes(activeLocId)),
            ),
          );
      })
      .catch(() => {
        if (active) toast.error("Menu could not be loaded");
      });
    return () => {
      active = false;
    };
  }, [org.id, activeLocId]);
  const categories = useMemo(() => {
    const cats = new Set(menuItems.map((m) => m.category));
    return ["all", ...Array.from(cats)];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    return menuItems.filter((i) => {
      const matchCat = selectedCat === "all" || i.category === selectedCat;
      const matchSearch =
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.description.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedCat, search]);

  const handleOpenItem = (item: MenuItem) => {
    if (item.modifierGroups && item.modifierGroups.length > 0) {
      setModModalItem(item);
      setSelectedMods({});
      setItemNotes("");
    } else {
      const updated = addItemToCart(session, item, [], 1);
      setSession(updated);
      toast.success(`${item.name} added`);
    }
  };

  const handleConfirmModifiers = () => {
    if (!modModalItem) return;
    const missingRequired = modModalItem.modifierGroups?.filter(
      (g) => g.required && (selectedMods[g.id]?.length ?? 0) === 0,
    );
    if (missingRequired && missingRequired.length > 0) {
      toast.error(t("pos.requiredModifier"));
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
    toast.success(`${modModalItem.name} added`);
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
    toast.info(t("pos.clearTicket"));
  };

  const handleApplyDiscountSubmit = () => {
    const val = parseFloat(discountInput || "0");
    const cents = Math.round(Math.max(0, isNaN(val) ? 0 : val) * 100);
    const updated = applyDiscount(session, cents);
    setSession(updated);
    setDiscountModalOpen(false);
    toast.success(t("pos.applyDiscount"));
  };

  const handleSuspend = () => {
    if (session.cart.length === 0) return;
    suspendSession(session, locationScope);
    toast.info(t("pos.suspend"));
    setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
  };

  const handleResume = (id: string) => {
    const resumed = resumeSession(org.id, id, locationScope);
    if (resumed) {
      setSession(resumed);
      toast.success(t("pos.resume"));
    }
  };

  const handleStartCheckout = () => {
    if (session.cart.length === 0) return;
    setTenderedInput((session.totalCents / 100).toFixed(2));
    setCheckoutOpen(true);
  };

  const [submittingSale, setSubmittingSale] = useState(false);

  const handleCompleteSale = async () => {
    if (submittingSale) return;
    const centsTendered = Math.round(parseFloat(tenderedInput || "0") * 100);
    const paid = simulatePayment(session, payMethod, centsTendered);
    if (payMethod === "cash" && centsTendered < paid.totalCents) {
      toast.error("Amount tendered is less than total amount");
      return;
    }
    setSubmittingSale(true);
    try {
      const idemKey = `pos-tx-${session.id || Date.now()}`;
      const persistRes = await persistFinalizedPOSSaleAtomic(paid, idemKey);
      if (!persistRes.success || !persistRes.orderId) {
        throw new Error(persistRes.error || "RPC persist_finalized_pos_sale_atomic unconfirmed");
      }

      const finalizedRecord = {
        ...paid,
        persistedOrderId: persistRes.orderId,
      };

      setReceiptSession(finalizedRecord);
      setCheckoutOpen(false);
      // Only reset active cart once server confirmed sale ID
      setSession(getPOSSession(org.id, activeLocId, cashierName, locationScope));
      toast.success(
        `Venda registrada com sucesso! Pedido #${persistRes.orderNumber || persistRes.orderId.slice(0, 8)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao registrar venda na base";
      toast.error(`Falha no POS: ${msg}. A venda NÃO foi confirmada.`);
    } finally {
      setSubmittingSale(false);
    }
  };

  const handleCancelPersistedSale = async () => {
    if (!receiptSession?.persistedOrderId || cancellingSale) return;
    const reason = cancelReason.trim() || "Cancelamento solicitado pelo operador no caixa";
    setCancellingSale(true);
    try {
      const res = await cancelOrderWithReversal(receiptSession.persistedOrderId, reason);
      if (!res.success) {
        throw new Error(res.error || "Falha na reversão atômica");
      }
      if (res.alreadyCancelled) {
        toast.info("Esta venda já havia sido cancelada previamente.");
      } else {
        toast.success("Venda cancelada e estoque revertido com sucesso.");
      }
      setCancelModalOpen(false);
      setReceiptSession(null);
      setCancelReason("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao cancelar venda";
      toast.error(`Falha ao cancelar: ${msg}`);
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

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-4 overflow-hidden lg:flex-row">
      {/* Main Catalog View */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3 bg-muted/20">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
            <Search className="size-4 text-muted-foreground" />
            <Input
              placeholder="Search menu items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="flex items-center gap-2">
            {org.fictional && (
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20 text-xs"
              >
                {t("pos.simulatedBadge")}
              </Badge>
            )}
            {session.suspendedSessions.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {t("pos.suspended")}:
                </span>
                {session.suspendedSessions.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="secondary"
                    onClick={() => handleResume(s.id)}
                    className="h-7 text-xs px-2"
                  >
                    <PlayCircle className="size-3 mr-1" /> {s.customerName || t("pos.resume")}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 overflow-x-auto border-b p-2 scrollbar-none">
          {categories.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={selectedCat === c ? "default" : "outline"}
              onClick={() => setSelectedCat(c)}
              className="h-8 text-xs capitalize shrink-0"
            >
              {c}
            </Button>
          ))}
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleOpenItem(item)}
              className="flex flex-col text-left justify-between p-3 rounded-lg border bg-card hover:border-primary/50 hover:shadow-sm active:scale-[0.98] transition-all duration-150"
            >
              <div>
                <p className="font-medium text-sm leading-snug line-clamp-2">{item.name}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {item.description}
                </p>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t w-full">
                <span className="font-semibold text-sm">{formatMoney(item.priceCents)}</span>
                <Plus className="size-4 text-primary" />
              </div>
            </button>
          ))}
          {filteredItems.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <ShoppingBag className="size-10 mb-2 opacity-40" />
              <p className="font-medium text-sm text-foreground">
                Cardápio operacional sem itens cadastrados
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Acesse a página de Cardápio para cadastrar categorias e produtos ativos para esta
                loja.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Cart Sidebar */}
      <div className="flex w-full lg:w-96 flex-col rounded-xl border bg-card shrink-0 overflow-hidden">
        {/* Header Order Settings */}
        <div className="border-b p-3 bg-muted/20 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <p className="font-semibold text-sm">Current Ticket</p>
            <span className="text-xs text-muted-foreground">Attendant: {session.cashierName}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["dine_in", "takeout", "delivery"] as OrderType[]).map((tType) => (
              <Button
                key={tType}
                size="sm"
                variant={session.orderType === tType ? "default" : "outline"}
                onClick={() => setSession(setOrderType(session, tType))}
                className="h-7 text-xs capitalize"
              >
                {tType.replace("_", " ")}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Customer name / table..."
              value={session.customerName}
              onChange={(e) => setSession(setCustomerInfo(session, e.target.value))}
              className="h-7 text-xs"
            />
          </div>
        </div>

        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 divide-y divide-border/40">
          {session.cart.map((item) => (
            <div key={item.id} className="pt-2 first:pt-0 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-xs truncate leading-snug">{item.productName}</p>
                {item.modifiers.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {item.modifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                {item.notes && (
                  <p className="text-[10px] italic text-amber-600 dark:text-amber-400">
                    {item.notes}
                  </p>
                )}
                <p className="text-xs font-semibold mt-0.5">{formatMoney(item.subtotalCents)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="outline"
                  className="size-6"
                  onClick={() => handleQuantity(item.id, -1)}
                >
                  <Minus className="size-3" />
                </Button>
                <span className="w-5 text-center text-xs font-medium">{item.quantity}</span>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-6"
                  onClick={() => handleQuantity(item.id, 1)}
                >
                  <Plus className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive"
                  onClick={() => setSession(removeItemFromCart(session, item.id))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
          {session.cart.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground my-auto">
              <ShoppingBag className="size-8 mb-2 opacity-30" />
              <p>Cart is currently empty</p>
            </div>
          )}
        </div>

        {/* Totals & Actions Footer */}
        <div className="border-t p-3 bg-muted/10 flex flex-col gap-2.5">
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(session.subtotalCents)}</span>
            </div>
            {session.discountCents > 0 && (
              <div className="flex justify-between text-emerald-600 font-medium">
                <span>Discount</span>
                <span>-{formatMoney(session.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Tax (8%)</span>
              <span>{formatMoney(session.taxCents)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t pt-1.5 mt-0.5 text-foreground">
              <span>Total</span>
              <span>{formatMoney(session.totalCents)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDiscountModalOpen(true)}
              className="h-8 text-xs"
            >
              <Tag className="size-3 mr-1" /> Discount
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSuspend}
              disabled={session.cart.length === 0}
              className="h-8 text-xs"
            >
              <PlayCircle className="size-3 mr-1" /> Hold
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearTicket}
              disabled={session.cart.length === 0}
              className="h-9 text-xs text-destructive hover:bg-destructive/10"
            >
              <XCircle className="size-3.5 mr-1" /> Clear
            </Button>
            <Button
              size="sm"
              className="col-span-2 h-9 text-xs font-semibold"
              onClick={handleStartCheckout}
              disabled={session.cart.length === 0}
            >
              <CreditCard className="size-4 mr-1.5" /> Charge {formatMoney(session.totalCents)}
            </Button>
          </div>
        </div>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Checkout ({formatMoney(session.totalCents)})</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={payMethod === "cash" ? "default" : "outline"}
                onClick={() => setPayMethod("cash")}
                className="h-16 flex-col gap-1"
              >
                <DollarSign className="size-5" />
                <span className="text-xs">Cash</span>
              </Button>
              <Button
                variant={payMethod === "card" ? "default" : "outline"}
                onClick={() => setPayMethod("card")}
                className="h-16 flex-col gap-1"
              >
                <CreditCard className="size-5" />
                <span className="text-xs">Credit / Debit</span>
              </Button>
              <Button
                variant={payMethod === "digital" ? "default" : "outline"}
                onClick={() => setPayMethod("digital")}
                className="h-16 flex-col gap-1"
              >
                <Smartphone className="size-5" />
                <span className="text-xs">Digital Wallet</span>
              </Button>
            </div>

            {payMethod === "cash" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Amount Tendered ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={tenderedInput}
                  onChange={(e) => setTenderedInput(e.target.value)}
                />
                {parseFloat(tenderedInput) * 100 > session.totalCents && (
                  <p className="text-xs text-emerald-600 font-semibold">
                    Change to return:{" "}
                    {formatMoney(Math.round(parseFloat(tenderedInput) * 100) - session.totalCents)}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submittingSale}
              onClick={() => setCheckoutOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={submittingSale} onClick={handleCompleteSale}>
              {submittingSale ? "Confirmando..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discount Modal */}
      <Dialog open={discountModalOpen} onOpenChange={setDiscountModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply Order Discount</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <label className="text-xs font-medium text-muted-foreground">Discount Amount ($)</label>
            <Input
              type="number"
              placeholder="0.00"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscountModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApplyDiscountSubmit}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog open={!!receiptSession} onOpenChange={(open) => !open && setReceiptSession(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Receipt className="size-4" /> Receipt Preview
            </DialogTitle>
          </DialogHeader>
          {receiptSession && (
            <div className="flex flex-col gap-2 p-3 border rounded bg-muted/10 font-mono text-xs">
              <div className="text-center border-b pb-2">
                <p className="font-bold text-sm">SERVORA RESTAURANT</p>
                <p className="text-[10px] text-muted-foreground">Simulation Receipt</p>
                <p className="text-[10px]">Cashier: {receiptSession.cashierName}</p>
              </div>
              <div className="flex flex-col gap-1 py-1 border-b">
                {receiptSession.cart.map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span>
                      {c.quantity}x {c.productName}
                    </span>
                    <span>{formatMoney(c.subtotalCents)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-0.5 pt-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span>{formatMoney(receiptSession.subtotalCents)}</span>
                </div>
                {receiptSession.discountCents > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount:</span>
                    <span>-{formatMoney(receiptSession.discountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax:</span>
                  <span>{formatMoney(receiptSession.taxCents)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm pt-1 border-t">
                  <span>Total Paid:</span>
                  <span>{formatMoney(receiptSession.totalCents)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
                  <span>Method:</span>
                  <span className="uppercase">{receiptSession.paymentMethod}</span>
                </div>
                {receiptSession.paymentMethod === "cash" && (
                  <div className="flex justify-between text-[11px] font-semibold text-emerald-600">
                    <span>Change:</span>
                    <span>{formatMoney(changeDueCents)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {receiptSession?.persistedOrderId && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setCancelModalOpen(true)}
                className="w-full sm:w-auto mr-auto text-xs"
              >
                <XCircle className="size-3.5 mr-1" /> Estornar / Cancelar
              </Button>
            )}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.print();
                }}
              >
                <Printer className="size-3.5 mr-1" /> Print
              </Button>
              <Button size="sm" onClick={() => setReceiptSession(null)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-1.5">
              <XCircle className="size-4" /> Cancelar Venda Efetivada
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Esta operação cancelará o pedido persistido no backend e reverterá automaticamente os
              movimentos de estoque e CMV.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground">Motivo do Cancelamento</label>
              <Input
                placeholder="Ex: Cliente desistiu, erro de digitação"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={cancellingSale}
              onClick={() => setCancelModalOpen(false)}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={cancellingSale}
              onClick={handleCancelPersistedSale}
            >
              {cancellingSale ? "Cancelando..." : "Confirmar Cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
