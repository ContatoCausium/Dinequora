import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  fetchOperationalResources,
  fetchOperationalMenu,
  saveOperationalRecord,
  moveOperationalInventory,
  receiveOperationalPurchase,
  cancelOperationalPurchase,
} from "@/lib/operational.functions";
import { mapResources, type MovementKind } from "@/lib/operational-mappers";
import type { MenuItem } from "@/lib/menu-service";
import {
  OperationalCreateDialog,
  operationalErrorText,
} from "@/components/app/operational-create-dialogs";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Boxes,
  ChefHat,
  CircleAlert,
  CircleCheck,
  Copy,
  History,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { StatTile } from "@/components/app/stat-tile";
import { EmptyState, Skeleton, StateCard } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { InventoryCategory, InventoryItem } from "@/lib/inventory-service";
import type { MovementType } from "@/lib/inventory-movements-service";
import {
  checkRecipeStockAvailability,
  calculateIngredientCost,
  type ProductRecipe,
  type RecipeIngredient,
  type RecipeUnit,
} from "@/lib/recipes-service";
import type { Supplier, PurchaseOrder, POStatus } from "@/lib/suppliers-purchases-service";
import { DemoBadge } from "@/components/app/brand-mark";
import { displayAmount, fmtDate, fmtMoneyCents, fmtPercent, fmtQuantity } from "@/lib/format";
import {
  centsFromDollars,
  centsToDecimalString,
  multiplyQuantityCents,
  centsFromNumberInput,
  sumCents,
} from "@/lib/money";

export const Route = createFileRoute("/_authenticated/_app/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory & Stock Movements · Dinequora" },
      {
        name: "description",
        content: "Store inventory, recipes, suppliers and purchase receiving.",
      },
      { property: "og:title", content: "Inventory & Stock Movements · Dinequora" },
      {
        property: "og:description",
        content: "Store inventory, recipes, suppliers and purchase receiving.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});

type Tab = "items" | "movements" | "recipes" | "suppliers" | "purchases";
const TABS: Tab[] = ["items", "movements", "recipes", "suppliers", "purchases"];
const CATEGORIES: InventoryCategory[] = [
  "meat",
  "produce",
  "dairy",
  "bakery",
  "dry_goods",
  "beverages",
  "packaging",
];
const MOVE_TYPES: MovementType[] = ["in", "out", "loss", "adjustment", "transfer"];
/** The backend only accepts receipts for these statuses (receive_operational_purchase). */
const RECEIVABLE: POStatus[] = ["sent", "partially_received"];
/** Cancelling is refused once anything was received. */
const CANCELLABLE: POStatus[] = ["draft", "sent"];

const KIND_VARIANT: Record<MovementKind, NonNullable<BadgeProps["variant"]>> = {
  opening: "neutral",
  receiving: "success",
  sale: "outline",
  reversal: "warning",
  adjustment: "neutral",
  transfer_in: "outline",
  transfer_out: "outline",
};
const PO_VARIANT: Record<POStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  sent: "outline",
  partially_received: "warning",
  received: "success",
  cancelled: "neutral",
};

type Movement = ReturnType<typeof mapResources>["movements"][number];
type RecipeForm = {
  productName: string;
  servings: number;
  yieldUnit: string;
  sellingPriceCents: number;
  prepInstructions: string;
  ingredients: RecipeIngredient[];
};

function stockStatus(item: InventoryItem): "out" | "low" | "ok" {
  if (item.quantity <= 0) return "out";
  if (item.quantity <= item.minQuantity) return "low";
  return "ok";
}
const STATUS_VARIANT = { out: "danger", low: "warning", ok: "success" } as const;

function newIngredient(item: InventoryItem): RecipeIngredient {
  return {
    id: `ri-${crypto.randomUUID()}`,
    inventoryItemId: item.id,
    name: item.name,
    quantity: 1,
    unit: (item.unit as RecipeUnit) || "units",
    wastePercentage: 0,
    unitCostCents: item.costCents,
    subtotalCostCents: item.costCents,
  };
}

export function InventoryPage() {
  const { t, i18n } = useTranslation("inventory");
  const lng = i18n.language;
  const { org, locationId, user, can, canAny } = useWorkspace();
  // UI hints from the member's permissions; the backend re-checks every action (migration 0018).
  const canCreateItem = can("inventory.create");
  const canMove = canAny(["inventory.adjust", "inventory.transfer"]);
  const canEditRecipes = can("recipes.edit");
  const canBuy = can("purchases.create");
  const canReceive = can("purchases.receive");
  const canCancelPO = can("purchases.cancel");
  const canApprovePO = can("purchases.approve");
  const canManage =
    canCreateItem ||
    canMove ||
    canEditRecipes ||
    canBuy ||
    canReceive ||
    canCancelPO ||
    canApprovePO;
  const isOwner = can("suppliers.edit");
  const showStore = locationId === "all";
  const defaultStore = locationId === "all" ? (org.locations[0]?.id ?? "") : locationId;

  const storeName = useCallback(
    (slug: string | undefined) =>
      org.locations.find((l) => l.id === slug)?.name ?? t("unknownStore"),
    [org.locations, t],
  );
  const unitLabel = (u: string, count?: number) =>
    t(`units.${u}`, count === undefined ? { defaultValue: u } : { defaultValue: u, count });
  const qty = (v: number, unit: string) => `${fmtQuantity(v, lng)} ${unitLabel(unit, Math.abs(v))}`;
  const money = (cents: number) => fmtMoneyCents(cents, lng);
  const errText = (e: unknown, fallbackKey: string) => operationalErrorText(t, e, t(fallbackKey));

  const [activeTab, setActiveTab] = useState<Tab>("items");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<ProductRecipe[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | InventoryCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "attention">("all");
  // Dense list by default; the choice is kept on this device. Read after mount so the server render
  // and the first client render match.
  const [itemsView, setItemsView] = useState<"list" | "cards">("list");
  useEffect(() => {
    try {
      if (localStorage.getItem("servora.inventory.view") === "cards") setItemsView("cards");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  const chooseItemsView = (v: "list" | "cards") => {
    setItemsView(v);
    try {
      localStorage.setItem("servora.inventory.view", v);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };

  // Recipe dialog
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<ProductRecipe | null>(null);
  const [recipeStore, setRecipeStore] = useState("");
  const [recipeFormData, setRecipeFormData] = useState<RecipeForm>({
    productName: "",
    servings: 1,
    yieldUnit: "",
    sellingPriceCents: 1200,
    prepInstructions: "",
    ingredients: [],
  });

  // Movement dialog
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [selectedItemForMove, setSelectedItemForMove] = useState<InventoryItem | null>(null);
  const [moveType, setMoveType] = useState<MovementType>("in");
  const [moveQty, setMoveQty] = useState<string>("1");
  const [moveReason, setMoveReason] = useState<string>("");
  const [targetLocationId, setTargetLocationId] = useState<string>("");
  const [moveEventKey, setMoveEventKey] = useState("");

  // Other dialogs
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [poModalOpen, setPOModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [selectedPOForReceive, setSelectedPOForReceive] = useState<PurchaseOrder | null>(null);
  const [receiveInputs, setReceiveInputs] = useState<
    Record<string, { qty: number; price: number; note: string }>
  >({});
  const [receivingNote, setReceivingNote] = useState("");
  const [receiptKey, setReceiptKey] = useState("");
  const [poToCancel, setPoToCancel] = useState<PurchaseOrder | null>(null);
  // Costs come only from inventory_item_costs() (migration 0020); without inventory.costs the
  // backend sends none, so every cost, value and margin below is hidden instead of shown as 0.
  const [costsVisible, setCostsVisible] = useState(false);

  const applyData = (
    r: Parameters<typeof mapResources>[0],
    menu: Awaited<ReturnType<typeof fetchOperationalMenu>>,
  ) => {
    const m = mapResources(r);
    setCostsVisible(m.costsVisible);
    setItems(m.items);
    setRecipes(m.recipes);
    setSuppliers(m.suppliers);
    setPurchaseOrders(m.purchases);
    setMovements(m.movements);
    setProducts(menu.items);
  };
  const refreshData = async () => {
    const [r, menu] = await Promise.all([
      fetchOperationalResources({ data: { orgId: org.id, locationId } }),
      fetchOperationalMenu({ data: { orgId: org.id } }),
    ]);
    applyData(r, menu);
  };
  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setItems([]);
    setRecipes([]);
    setSuppliers([]);
    setPurchaseOrders([]);
    setMovements([]);
    Promise.all([
      fetchOperationalResources({ data: { orgId: org.id, locationId } }),
      fetchOperationalMenu({ data: { orgId: org.id } }),
    ])
      .then(([r, menu]) => {
        if (!active) return;
        applyData(r, menu);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [org.id, locationId, reloadTick]);

  /** With "All stores", keep each store's records together (store name, then the given order). */
  const byStore = useCallback(
    <T extends { locationId?: string | undefined }>(list: T[], name: (x: T) => string): T[] =>
      showStore
        ? [...list].sort(
            (a, b) =>
              storeName(a.locationId).localeCompare(storeName(b.locationId), lng) ||
              name(a).localeCompare(name(b), lng),
          )
        : list,
    [showStore, storeName, lng],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return byStore(
      items.filter(
        (itm) =>
          (categoryFilter === "all" || itm.category === categoryFilter) &&
          (itm.name.toLowerCase().includes(q) || itm.sku.toLowerCase().includes(q)),
      ),
      (i) => i.name,
    );
  }, [items, categoryFilter, search, byStore]);
  const attentionCount = useMemo(
    () => filteredItems.filter((i) => stockStatus(i) !== "ok").length,
    [filteredItems],
  );
  /** Items grouped by store ("All stores") and ordered out of stock → low → in stock, then by name. */
  const itemGroups = useMemo(() => {
    const SEVERITY = { out: 0, low: 1, ok: 2 } as const;
    const visible = filteredItems.filter((i) => statusFilter === "all" || stockStatus(i) !== "ok");
    const order = (a: InventoryItem, b: InventoryItem) =>
      SEVERITY[stockStatus(a)] - SEVERITY[stockStatus(b)] || a.name.localeCompare(b.name, lng);
    const keys = showStore
      ? [
          ...org.locations.map((l) => l.id),
          ...new Set(visible.map((i) => i.locationId ?? "")),
        ].filter((k, idx, arr) => arr.indexOf(k) === idx)
      : [""];
    return keys
      .map((key) => {
        const list = (showStore ? visible.filter((i) => (i.locationId ?? "") === key) : visible)
          .slice()
          .sort(order);
        return {
          key: key || "all",
          title: showStore ? storeName(key || undefined) : null,
          items: list,
          attention: list.filter((i) => stockStatus(i) !== "ok").length,
        };
      })
      .filter((g) => g.items.length > 0);
  }, [filteredItems, statusFilter, showStore, org.locations, storeName, lng]);
  const sortedRecipes = useMemo(() => byStore(recipes, (r) => r.productName), [recipes, byStore]);
  const sortedPurchases = useMemo(
    () =>
      showStore
        ? [...purchaseOrders].sort((a, b) =>
            storeName(a.locationId).localeCompare(storeName(b.locationId), lng),
          )
        : purchaseOrders,
    [purchaseOrders, showStore, storeName, lng],
  );

  const kpis = useMemo(
    () => ({
      count: items.length,
      low: items.filter((i) => stockStatus(i) === "low").length,
      out: items.filter((i) => stockStatus(i) === "out").length,
      valueCents: displayAmount(
        () =>
          sumCents(items.map((i) => multiplyQuantityCents(Math.max(0, i.quantity), i.costCents))),
        "money.stock_value",
      ),
    }),
    [items],
  );

  // ---------- Recipes ----------
  const openRecipeModal = (recipe?: ProductRecipe, mode: "edit" | "duplicate" = "edit") => {
    if (recipe) {
      setSelectedRecipe(mode === "edit" ? recipe : null);
      setRecipeStore(recipe.locationId ?? defaultStore);
      setRecipeFormData({
        productName: mode === "edit" ? recipe.productName : "",
        servings: recipe.servings,
        yieldUnit: recipe.yieldUnit,
        sellingPriceCents: recipe.sellingPriceCents,
        prepInstructions: recipe.prepInstructions || "",
        ingredients: recipe.ingredients.map((i) =>
          mode === "edit" ? i : { ...i, id: `ri-${crypto.randomUUID()}` },
        ),
      });
    } else {
      const first = items.find((i) => i.locationId === defaultStore);
      setSelectedRecipe(null);
      setRecipeStore(defaultStore);
      setRecipeFormData({
        productName: "",
        servings: 1,
        yieldUnit: t("recipes.defaultYieldUnit"),
        sellingPriceCents: 1400,
        prepInstructions: "",
        ingredients: first ? [newIngredient(first)] : [],
      });
    }
    setRecipeModalOpen(true);
  };
  const recipeStoreItems = items.filter((i) => i.locationId === recipeStore);

  const handleSaveRecipeForm = async () => {
    if (busy) return;
    const product = products.find((p) => p.name === recipeFormData.productName.trim());
    if (!product) {
      toast.error(t("recipeDialog.productRequired"));
      return;
    }
    if (recipeFormData.ingredients.length === 0) {
      toast.error(t("recipeDialog.ingredientsRequired"));
      return;
    }
    if (!recipeStore) {
      toast.error(t("recipeDialog.storeRequired"));
      return;
    }
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          locationId: recipeStore,
          kind: "recipe",
          payload: {
            ...(selectedRecipe ? { id: selectedRecipe.id } : {}),
            productId: product.id,
            productName: product.name,
            servings: recipeFormData.servings,
            yieldQuantity: recipeFormData.servings,
            yieldUnit: recipeFormData.yieldUnit,
            prepInstructions: recipeFormData.prepInstructions,
            sellingPriceCents: recipeFormData.sellingPriceCents,
            // Only what the recipe is made of. Cost snapshots are computed for display and never
            // sent: product_recipes.metadata is readable without inventory.costs (migration 0024).
            ingredients: recipeFormData.ingredients.map((i) => ({
              inventoryItemId: i.inventoryItemId,
              quantity: i.quantity,
              unit: i.unit,
              wastePercentage: i.wastePercentage,
            })),
          },
        },
      });
      setRecipeModalOpen(false);
      toast.success(t("recipeDialog.success"));
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (e) {
      toast.error(errText(e, "recipeDialog.failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshCosts = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshData();
      toast.success(t("recipes.refreshCostsSuccess"));
    } catch {
      toast.error(t("recipes.refreshCostsFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Movements ----------
  const transferTargets = org.locations.filter(
    (l) => l.id !== (selectedItemForMove?.locationId ?? defaultStore),
  );
  const handleOpenMovementModal = (item?: InventoryItem) => {
    const chosen = item ?? filteredItems[0] ?? items[0] ?? null;
    setSelectedItemForMove(chosen);
    setMoveType("in");
    setMoveQty("1");
    setMoveReason("");
    setMoveEventKey(crypto.randomUUID());
    const target = org.locations.find((l) => l.id !== (chosen?.locationId ?? defaultStore));
    setTargetLocationId(target?.id ?? "");
    setMovementModalOpen(true);
  };

  const handleRecordMovement = async () => {
    if (!selectedItemForMove || busy) return;
    const quantity = parseFloat(moveQty);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error(t("moveDialog.invalidQuantity"));
      return;
    }
    if (!moveReason.trim()) {
      toast.error(t("moveDialog.reasonRequired"));
      return;
    }
    const source = selectedItemForMove.locationId || defaultStore;
    setBusy(true);
    try {
      await moveOperationalInventory({
        data: {
          orgId: org.id,
          itemId: selectedItemForMove.id,
          type: moveType,
          quantity,
          reason: moveReason.trim(),
          locationId: source,
          clientEventId: moveEventKey,
          ...(moveType === "transfer" ? { targetLocationId } : {}),
        },
      });
      toast.success(t("moveDialog.success"));
      setMovementModalOpen(false);
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (err) {
      toast.error(errText(err, "moveDialog.failed"));
    } finally {
      setBusy(false);
    }
  };

  const performerLabel = (m: Movement) =>
    !m.performedBy
      ? t("movements.system")
      : m.performedBy === user.id
        ? t("movements.you")
        : t("movements.teamMember");

  // ---------- Purchases ----------
  const openReceive = (po: PurchaseOrder) => {
    setSelectedPOForReceive(po);
    setReceiptKey(crypto.randomUUID());
    const initial: Record<string, { qty: number; price: number; note: string }> = {};
    po.items.forEach((it) => {
      initial[it.id] = {
        qty: Math.max(0, it.quantityOrdered - it.quantityReceived),
        price: Number(centsToDecimalString(it.unitPriceCents)),
        note: "",
      };
    });
    setReceiveInputs(initial);
    setReceivingNote("");
    setReceiveModalOpen(true);
  };
  const handleConfirmReceive = async () => {
    if (!selectedPOForReceive || busy) return;
    setBusy(true);
    try {
      const payload = Object.entries(receiveInputs).map(([itemId, val]) => ({
        itemId,
        receivedNow: val.qty,
        priceVerifiedCents: centsFromDollars(val.price),
        divergenceReason: val.note,
      }));
      await receiveOperationalPurchase({
        data: {
          id: selectedPOForReceive.id,
          items: payload,
          clientEventId: receiptKey,
          notes: receivingNote,
        },
      });
      setReceiveModalOpen(false);
      toast.success(t("receiveDialog.success"));
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (e) {
      toast.error(errText(e, "receiveDialog.failed"));
    } finally {
      setBusy(false);
    }
  };
  const handleCancelPO = async (po: PurchaseOrder) => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelOperationalPurchase({ data: { id: po.id, reason: t("purchases.cancelReason") } });
      toast.success(t("purchases.cancelSuccess"));
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (e) {
      toast.error(errText(e, "purchases.cancelFailed"));
    } finally {
      setBusy(false);
      setPoToCancel(null);
    }
  };

  /** Draft → sent through the same audited save RPC (it only accepts draft/sent and locks after receipts). */
  const handleSendPO = async (po: PurchaseOrder) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          locationId: po.locationId,
          kind: "purchase",
          payload: {
            id: po.id,
            supplierId: po.supplierId,
            supplierName: po.supplierName,
            status: "sent",
            discountCents: po.discountCents,
            taxCents: po.taxCents,
            shippingCents: po.shippingCents,
            notes: po.notes,
            items: po.items.map((i) => ({
              inventoryItemId: i.inventoryItemId,
              quantityOrdered: i.quantityOrdered,
              unitPriceCents: i.unitPriceCents,
            })),
          },
        },
      });
      toast.success(t("purchases.sendSuccess"));
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (e) {
      toast.error(errText(e, "purchases.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Suppliers ----------
  const handleToggleSupplier = async (sup: Supplier) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: { orgId: org.id, kind: "supplier", payload: { ...sup, active: !sup.active } },
      });
      toast.success(t("suppliers.statusUpdated"));
      await refreshData().catch(() => setReloadTick((n) => n + 1));
    } catch (e) {
      toast.error(errText(e, "suppliers.statusFailed"));
    } finally {
      setBusy(false);
    }
  };

  const storeLine = (slug: string | undefined) =>
    showStore ? (
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{storeName(slug)}</p>
    ) : null;

  // ---------- Header actions (one primary per tab) ----------
  const headerActions = (() => {
    if (!canManage) return null;
    if (activeTab === "recipes")
      return (
        <>
          {costsVisible && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshCosts}
              disabled={busy || loadState !== "ready"}
              title={t("recipes.refreshCostsHint")}
            >
              <RefreshCw className="mr-1.5 size-4" />
              {t("recipes.refreshCosts")}
            </Button>
          )}
          {canEditRecipes && (
            <Button size="sm" onClick={() => openRecipeModal()} disabled={loadState !== "ready"}>
              <Plus className="mr-1.5 size-4" />
              {t("recipes.newRecipe")}
            </Button>
          )}
        </>
      );
    if (activeTab === "suppliers")
      return isOwner ? (
        <Button size="sm" onClick={() => setSupplierModalOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          {t("suppliers.newSupplier")}
        </Button>
      ) : null;
    if (activeTab === "purchases")
      return canBuy ? (
        <Button
          size="sm"
          onClick={() => setPOModalOpen(true)}
          disabled={loadState !== "ready" || suppliers.length === 0 || items.length === 0}
        >
          <Plus className="mr-1.5 size-4" />
          {t("purchases.newPO")}
        </Button>
      ) : null;
    return (
      <>
        {canCreateItem && (
          <Button size="sm" variant="outline" onClick={() => setItemModalOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            {t("actions.newItem")}
          </Button>
        )}
        {canMove && (
          <Button
            size="sm"
            onClick={() => handleOpenMovementModal()}
            disabled={loadState !== "ready" || items.length === 0}
            title={items.length === 0 ? t("moveDialog.noItems") : undefined}
          >
            <ArrowUpDown className="mr-1.5 size-4" />
            {t("actions.registerMovement")}
          </Button>
        )}
      </>
    );
  })();

  const itemCard = (item: InventoryItem) => {
    const status = stockStatus(item);
    const meta = [item.sku ? t("items.sku", { sku: item.sku }) : "", item.supplier]
      .filter(Boolean)
      .join(" · ");
    return (
      <div key={item.id} className="surface flex flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold" title={item.name}>
              {item.name}
            </h3>
            {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
          </div>
          <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
            {t(`status.${status}`)}
          </Badge>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">{t("items.onHand")}</span>
            <p className="tabular text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              {fmtQuantity(item.quantity, lng)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {unitLabel(item.unit, item.quantity)}
              </span>
            </p>
          </div>
          <dl className="text-right text-xs">
            <dt className="text-muted-foreground">{t("items.minimum")}</dt>
            <dd className="tabular font-medium">{qty(item.minQuantity, item.unit)}</dd>
            {costsVisible && (
              <>
                <dt className="mt-1 text-muted-foreground">{t("items.unitCost")}</dt>
                <dd className="tabular font-medium">{money(item.costCents)}</dd>
              </>
            )}
          </dl>
        </div>
        {canMove && (
          <div className="mt-3 flex justify-end border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenMovementModal(item)}
              aria-label={t("actions.moveItem", { name: item.name })}
            >
              <ArrowUpDown className="mr-1.5 size-3.5" />
              {t("actions.move")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const itemTable = (list: InventoryItem[]) => (
    // `relative` keeps the absolutely positioned sr-only header inside the scroll box on phones.
    <div className="surface relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">{t("items.columns.item")}</th>
            <th className="px-3 py-2.5 font-medium">{t("items.columns.status")}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t("items.onHand")}</th>
            <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">
              {t("items.minimum")}
            </th>
            {costsVisible && (
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">
                {t("items.unitCost")}
              </th>
            )}
            {canMove && (
              <th className="px-4 py-2.5">
                <span className="sr-only">{t("items.columns.actions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {list.map((item) => {
            const status = stockStatus(item);
            const meta = [item.sku ? t("items.sku", { sku: item.sku }) : "", item.supplier]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={item.id} className="align-middle hover:bg-muted/40">
                <td className="max-w-[16rem] px-4 py-2.5">
                  <p className="truncate font-medium" title={item.name}>
                    {item.name}
                  </p>
                  {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={STATUS_VARIANT[status]} className="whitespace-nowrap">
                    {t(`status.${status}`)}
                  </Badge>
                </td>
                <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium">
                  {qty(item.quantity, item.unit)}
                </td>
                <td className="tabular hidden whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground sm:table-cell">
                  {qty(item.minQuantity, item.unit)}
                </td>
                {costsVisible && (
                  <td className="tabular hidden whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground md:table-cell">
                    {money(item.costCents)}
                  </td>
                )}
                {canMove && (
                  <td className="px-4 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenMovementModal(item)}
                      aria-label={t("actions.moveItem", { name: item.name })}
                    >
                      <ArrowUpDown className="size-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">{t("actions.move")}</span>
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ---------- Tab bodies ----------
  const renderItems = () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label={t("items.searchLabel")}
            placeholder={t("items.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label={t("categories.label")}
          className="h-9 rounded-md border bg-background px-3 text-sm lg:w-56"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as "all" | InventoryCategory)}
        >
          <option value="all">{t("categories.all")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <div
            role="radiogroup"
            aria-label={t("items.filter.label")}
            className="inline-flex rounded-md border bg-muted/40 p-0.5"
          >
            {(["all", "attention"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={statusFilter === f}
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  statusFilter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`items.filter.${f}`, {
                  count: f === "all" ? filteredItems.length : attentionCount,
                })}
              </button>
            ))}
          </div>
          <div
            role="radiogroup"
            aria-label={t("items.view.label")}
            className="inline-flex rounded-md border bg-muted/40 p-0.5"
          >
            {(["list", "cards"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={itemsView === v}
                aria-label={t(`items.view.${v}`)}
                title={t(`items.view.${v}`)}
                onClick={() => chooseItemsView(v)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded transition-colors",
                  itemsView === v
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "list" ? (
                  <List className="size-4" aria-hidden />
                ) : (
                  <LayoutGrid className="size-4" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<Boxes className="size-5" strokeWidth={1.75} />}
            title={t("items.emptyTitle")}
            body={t("items.emptyBody")}
            action={
              canCreateItem ? (
                <Button size="sm" variant="outline" onClick={() => setItemModalOpen(true)}>
                  <Plus className="mr-1.5 size-4" />
                  {t("actions.newItem")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<Search className="size-5" strokeWidth={1.75} />}
            title={t("items.noMatchTitle")}
            body={t("items.noMatchBody")}
          />
        </div>
      ) : itemGroups.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<CircleCheck className="size-5" strokeWidth={1.75} />}
            title={t("items.noAttentionTitle")}
            body={t("items.noAttentionBody")}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {itemGroups.map((group) => (
            <section key={group.key} aria-label={group.title ?? undefined} className="space-y-3">
              {group.title && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("items.groupItems", { count: group.items.length })}
                    {group.attention > 0 && (
                      <span className="text-warning">
                        {" · "}
                        {t("items.groupAttention", { count: group.attention })}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {itemsView === "list" ? (
                itemTable(group.items)
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map(itemCard)}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );

  const renderMovements = () => (
    <Panel title={t("movements.title")} subtitle={t("movements.subtitle")} bodyClassName="p-0 pt-3">
      {movements.length === 0 ? (
        <EmptyState
          icon={<History className="size-5" strokeWidth={1.75} />}
          title={t("movements.emptyTitle")}
          body={t("movements.emptyBody")}
        />
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-5 py-2 font-medium">{t("movements.date")}</th>
                <th className="px-3 py-2 font-medium">{t("movements.item")}</th>
                <th className="px-3 py-2 font-medium">{t("movements.type")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("movements.change")}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("movements.resultingBalance")}
                </th>
                <th className="px-3 py-2 font-medium">{t("movements.reason")}</th>
                <th className="px-5 py-2 font-medium">{t("movements.performedBy")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {movements.map((m) => (
                <tr key={m.id} className="align-top hover:bg-muted/40">
                  <td className="tabular whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                    {fmtDate(m.createdAt, lng, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{m.itemName}</span>
                    {storeLine(m.locationId)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={KIND_VARIANT[m.kind]} className="whitespace-nowrap">
                      {t(`movements.kinds.${m.kind}`)}
                    </Badge>
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium">
                    {m.quantityDelta > 0 ? "+" : ""}
                    {qty(m.quantityDelta, m.unit)}
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">
                    {m.resultingQuantity === null ? "—" : qty(m.resultingQuantity, m.unit)}
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-muted-foreground">
                    <span className="line-clamp-2" title={m.reason}>
                      {m.reason}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                    {performerLabel(m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  const renderRecipes = () =>
    sortedRecipes.length === 0 ? (
      <div className="surface">
        <EmptyState
          icon={<ChefHat className="size-5" strokeWidth={1.75} />}
          title={t("recipes.emptyTitle")}
          body={t("recipes.emptyBody")}
          action={
            canEditRecipes ? (
              <Button size="sm" variant="outline" onClick={() => openRecipeModal()}>
                <Plus className="mr-1.5 size-4" />
                {t("recipes.createFirst")}
              </Button>
            ) : undefined
          }
        />
      </div>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedRecipes.map((rec) => {
          const hasMissing = checkRecipeStockAvailability(rec, items).some((a) => !a.isSufficient);
          return (
            <div key={rec.id} className="surface flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold" title={rec.productName}>
                    {rec.productName}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("recipes.yield", {
                      quantity: fmtQuantity(rec.servings, lng),
                      unit: rec.yieldUnit,
                    })}
                  </p>
                  {storeLine(rec.locationId)}
                </div>
                <Badge variant={hasMissing ? "warning" : "success"} className="shrink-0">
                  {hasMissing ? t("recipes.insufficient") : t("recipes.sufficient")}
                </Badge>
              </div>

              <dl
                className={`mt-3 grid gap-2 rounded-md bg-muted/50 p-2.5 text-xs ${costsVisible ? "grid-cols-3" : "grid-cols-1"}`}
              >
                {costsVisible && (
                  <div>
                    <dt className="text-muted-foreground">{t("recipes.costPerServing")}</dt>
                    <dd className="tabular mt-0.5 text-sm font-semibold">
                      {money(rec.costPerServingCents)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">{t("recipes.sellingPrice")}</dt>
                  <dd className="tabular mt-0.5 text-sm font-semibold">
                    {money(rec.sellingPriceCents)}
                  </dd>
                </div>
                {costsVisible && (
                  <div>
                    <dt className="text-muted-foreground">{t("recipes.margin")}</dt>
                    <dd className="tabular mt-0.5 text-sm font-semibold">
                      {fmtPercent(rec.estimatedMarginPercent / 100, lng)}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-3 flex-1 text-xs">
                <p className="mb-1 font-medium text-muted-foreground">
                  {t("recipes.ingredientsTitle", { count: rec.ingredients.length })}
                </p>
                <ul className="max-h-36 divide-y overflow-y-auto rounded-md border">
                  {rec.ingredients.map((ing) => (
                    <li
                      key={ing.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5"
                    >
                      <span className="truncate">{ing.name}</span>
                      <span className="tabular shrink-0 text-muted-foreground">
                        {qty(ing.quantity, ing.unit)}
                        {costsVisible && <> · {money(ing.subtotalCostCents)}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {canEditRecipes && (
                <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openRecipeModal(rec, "duplicate")}
                    aria-label={t("recipes.duplicateLabel", { name: rec.productName })}
                  >
                    <Copy className="mr-1.5 size-3.5" />
                    {t("recipes.duplicate")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openRecipeModal(rec)}
                    aria-label={t("recipes.editLabel", { name: rec.productName })}
                  >
                    <Pencil className="mr-1.5 size-3.5" />
                    {t("recipes.edit")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );

  const renderSuppliers = () =>
    suppliers.length === 0 ? (
      <div className="surface">
        <EmptyState
          icon={<Truck className="size-5" strokeWidth={1.75} />}
          title={t("suppliers.emptyTitle")}
          body={isOwner ? t("suppliers.emptyBody") : t("suppliers.ownerOnly")}
          action={
            isOwner ? (
              <Button size="sm" variant="outline" onClick={() => setSupplierModalOpen(true)}>
                <Plus className="mr-1.5 size-4" />
                {t("suppliers.newSupplier")}
              </Button>
            ) : undefined
          }
        />
      </div>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((sup) => (
          <div key={sup.id} className="surface flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{sup.name}</h3>
                {sup.contactName && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t("suppliers.contact", { name: sup.contactName })}
                  </p>
                )}
              </div>
              <Badge variant={sup.active ? "success" : "neutral"} className="shrink-0">
                {sup.active ? t("suppliers.active") : t("suppliers.inactive")}
              </Badge>
            </div>
            {(sup.email || sup.phone || sup.address) && (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {sup.email && (
                  <>
                    <dt className="text-muted-foreground">{t("suppliers.email")}</dt>
                    <dd className="truncate">{sup.email}</dd>
                  </>
                )}
                {sup.phone && (
                  <>
                    <dt className="text-muted-foreground">{t("suppliers.phone")}</dt>
                    <dd className="truncate">{sup.phone}</dd>
                  </>
                )}
                {sup.address && (
                  <>
                    <dt className="text-muted-foreground">{t("suppliers.address")}</dt>
                    <dd className="truncate">{sup.address}</dd>
                  </>
                )}
              </dl>
            )}
            {sup.notes && (
              <p className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {sup.notes}
              </p>
            )}
            {isOwner && (
              <div className="mt-3 flex justify-end border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleToggleSupplier(sup)}
                >
                  {sup.active ? t("suppliers.deactivate") : t("suppliers.reactivate")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    );

  const renderPurchases = () =>
    sortedPurchases.length === 0 ? (
      <div className="surface">
        <EmptyState
          icon={<ShoppingCart className="size-5" strokeWidth={1.75} />}
          title={t("purchases.emptyTitle")}
          body={
            suppliers.length === 0 ? t("purchases.emptyNeedsSupplier") : t("purchases.emptyBody")
          }
        />
      </div>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedPurchases.map((po) => {
          const receivable = canReceive && RECEIVABLE.includes(po.status);
          const cancellable = canCancelPO && CANCELLABLE.includes(po.status);
          const hint =
            po.status === "draft" || po.status === "received" || po.status === "cancelled"
              ? t(`purchases.receiveHint.${po.status}`)
              : null;
          return (
            <div key={po.id} className="surface flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold">{po.poNumber}</span>
                  <p className="mt-0.5 truncate text-xs font-medium">{po.supplierName}</p>
                  {storeLine(po.locationId)}
                </div>
                <Badge variant={PO_VARIANT[po.status]} className="shrink-0">
                  {t(`purchases.statuses.${po.status}`)}
                </Badge>
              </div>

              <div className="mt-3 flex-1 text-xs">
                <p className="mb-1 font-medium text-muted-foreground">
                  {t("purchases.itemsTitle", { count: po.items.length })}
                </p>
                <ul className="max-h-32 divide-y overflow-y-auto rounded-md border">
                  {po.items.map((it) => (
                    <li key={it.id} className="px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{it.name}</span>
                        <span className="tabular shrink-0">{qty(it.quantityOrdered, it.unit)}</span>
                      </div>
                      {it.quantityReceived > 0 && (
                        <p className="tabular text-muted-foreground">
                          {t("purchases.receivedOf", {
                            received: fmtQuantity(it.quantityReceived, lng),
                            ordered: fmtQuantity(it.quantityOrdered, lng),
                            unit: unitLabel(it.unit),
                          })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">
                  {po.expectedDeliveryDate
                    ? t("purchases.expectedOn", { date: fmtDate(po.expectedDeliveryDate, lng) })
                    : t("purchases.createdOn", { date: fmtDate(po.createdAt, lng) })}
                </span>
                <span className="tabular text-right">
                  <span className="mr-1.5 text-muted-foreground">{t("purchases.total")}</span>
                  <span className="text-base font-semibold">{money(po.totalCents)}</span>
                </span>
              </div>

              {canManage && (receivable || cancellable || hint) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : <span />}
                  <div className="flex items-center gap-2">
                    {cancellable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setPoToCancel(po)}
                      >
                        {t("purchases.cancelOrder")}
                      </Button>
                    )}
                    {po.status === "draft" && canApprovePO && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleSendPO(po)}
                      >
                        <Send className="mr-1.5 size-3.5" />
                        {t("purchases.sendToSupplier")}
                      </Button>
                    )}
                    {receivable && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => openReceive(po)}
                      >
                        <Truck className="mr-1.5 size-3.5" />
                        {t("purchases.receiveGoods")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );

  const body =
    loadState === "loading" ? (
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        role="status"
        aria-label={t("load.loading")}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    ) : loadState === "error" ? (
      <div className="surface">
        <StateCard
          tone="danger"
          icon={<CircleAlert className="size-5" strokeWidth={1.75} />}
          title={t("load.errorTitle")}
          body={t("load.errorBody")}
          action={
            <Button variant="outline" size="sm" onClick={() => setReloadTick((n) => n + 1)}>
              <RefreshCw className="mr-1.5 size-3.5" />
              {t("actions.retry")}
            </Button>
          }
        />
      </div>
    ) : activeTab === "items" ? (
      renderItems()
    ) : activeTab === "movements" ? (
      renderMovements()
    ) : activeTab === "recipes" ? (
      renderRecipes()
    ) : activeTab === "suppliers" ? (
      renderSuppliers()
    ) : (
      renderPurchases()
    );

  const scopeHint = locationId === "all" ? t("allStores") : storeName(locationId);
  const selectedRecipeProduct = recipeFormData.productName;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <span className="eyebrow">{org.name}</span>
            {org.fictional && <DemoBadge label={t("simulatedBadge")} />}
          </div>
        }
        title={t("title")}
        description={t("subtitle")}
        actions={headerActions}
      />

      {loadState === "ready" && (
        <div
          className={`grid grid-cols-2 gap-4 ${costsVisible ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
        >
          <StatTile
            label={t("kpis.items")}
            value={fmtQuantity(kpis.count, lng, 0)}
            hint={scopeHint}
          />
          <StatTile
            label={t("kpis.lowStock")}
            value={fmtQuantity(kpis.low, lng, 0)}
            hint={t("kpis.atOrBelowMin")}
            tone={kpis.low > 0 ? "warning" : "neutral"}
          />
          <StatTile
            label={t("kpis.outOfStock")}
            value={fmtQuantity(kpis.out, lng, 0)}
            hint={t("kpis.zeroOnHand")}
            tone={kpis.out > 0 ? "negative" : "neutral"}
          />
          {costsVisible && (
            <StatTile
              label={t("kpis.stockValue")}
              value={money(kpis.valueCents)}
              hint={t("kpis.valueHint")}
            />
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label={t("tabsLabel")} className="h-10">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="px-3.5">
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {body}

      <OperationalCreateDialog
        purchaseStatus={canApprovePO ? "sent" : "draft"}
        kind="inventory"
        open={itemModalOpen}
        onOpenChange={setItemModalOpen}
        orgId={org.id}
        locationId={locationId === "all" ? undefined : locationId}
        locations={org.locations}
        items={items}
        suppliers={suppliers}
        onSaved={refreshData}
      />
      <OperationalCreateDialog
        kind="supplier"
        open={supplierModalOpen}
        onOpenChange={setSupplierModalOpen}
        orgId={org.id}
        locationId={undefined}
        items={items}
        suppliers={suppliers}
        onSaved={refreshData}
      />
      <OperationalCreateDialog
        kind="purchase"
        open={poModalOpen}
        onOpenChange={setPOModalOpen}
        orgId={org.id}
        locationId={locationId === "all" ? undefined : locationId}
        locations={org.locations}
        items={items}
        suppliers={suppliers}
        onSaved={refreshData}
      />

      {/* Recipe card dialog */}
      <Dialog open={recipeModalOpen} onOpenChange={setRecipeModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {selectedRecipe ? t("recipeDialog.titleEdit") : t("recipeDialog.titleNew")}
            </DialogTitle>
            <DialogDescription>{t("recipeDialog.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {!selectedRecipe && org.locations.length > 1 && (
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="recipe-store">{t("recipeDialog.store")}</Label>
                  <select
                    id="recipe-store"
                    className="h-9 w-full rounded-md border bg-background px-3"
                    value={recipeStore}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRecipeStore(next);
                      const first = items.find((i) => i.locationId === next);
                      // Ingredients must belong to the recipe's own store.
                      setRecipeFormData({
                        ...recipeFormData,
                        ingredients: first ? [newIngredient(first)] : [],
                      });
                    }}
                  >
                    {org.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="recipe-product">{t("recipeDialog.product")}</Label>
                <select
                  id="recipe-product"
                  className="h-9 w-full rounded-md border bg-background px-3"
                  value={selectedRecipeProduct}
                  onChange={(e) =>
                    setRecipeFormData({ ...recipeFormData, productName: e.target.value })
                  }
                >
                  <option value="">{t("recipeDialog.productPlaceholder")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipe-servings">{t("recipeDialog.servings")}</Label>
                <Input
                  id="recipe-servings"
                  type="number"
                  min="1"
                  value={recipeFormData.servings}
                  onChange={(e) =>
                    setRecipeFormData({
                      ...recipeFormData,
                      servings: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipe-price">{t("recipeDialog.sellingPrice")}</Label>
                <Input
                  id="recipe-price"
                  type="number"
                  step="0.50"
                  min="0"
                  value={centsToDecimalString(recipeFormData.sellingPriceCents)}
                  onChange={(e) =>
                    setRecipeFormData({
                      ...recipeFormData,
                      // <input type="number">: "." decimal, exact; an unreadable value keeps the price.
                      sellingPriceCents:
                        centsFromNumberInput(e.target.value || "0") ??
                        recipeFormData.sellingPriceCents,
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t("recipeDialog.ingredients", { count: recipeFormData.ingredients.length })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={recipeStoreItems.length === 0}
                  onClick={() => {
                    const first = recipeStoreItems[0];
                    if (!first) return;
                    setRecipeFormData({
                      ...recipeFormData,
                      ingredients: [...recipeFormData.ingredients, newIngredient(first)],
                    });
                  }}
                >
                  <Plus className="mr-1.5 size-3.5" />
                  {t("recipeDialog.addIngredient")}
                </Button>
              </div>
              {recipeStoreItems.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("recipeDialog.noStoreItems")}</p>
              )}

              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {recipeFormData.ingredients.map((ing, idx) => (
                  <div
                    key={ing.id}
                    className="grid grid-cols-12 items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs"
                  >
                    <div className="col-span-5">
                      <select
                        aria-label={t("recipeDialog.ingredient", { index: idx + 1 })}
                        value={ing.inventoryItemId}
                        onChange={(e) => {
                          const chosen = recipeStoreItems.find((i) => i.id === e.target.value);
                          if (!chosen) return;
                          const updated = [...recipeFormData.ingredients];
                          const costs = calculateIngredientCost(
                            chosen,
                            ing.quantity,
                            ing.unit,
                            ing.wastePercentage,
                          );
                          updated[idx] = {
                            ...ing,
                            inventoryItemId: chosen.id,
                            name: chosen.name,
                            unitCostCents: costs.unitCostCents,
                            subtotalCostCents: costs.subtotalCostCents,
                          };
                          setRecipeFormData({ ...recipeFormData, ingredients: updated });
                        }}
                        className="h-8 w-full truncate rounded-md border bg-background px-2 text-xs"
                      >
                        {recipeStoreItems.map((i) => (
                          <option key={i.id} value={i.id}>
                            {costsVisible
                              ? t("recipeDialog.ingredientOption", {
                                  name: i.name,
                                  price: money(i.costCents),
                                  unit: unitLabel(i.unit),
                                })
                              : i.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4 flex items-center gap-1.5">
                      <Input
                        aria-label={t("recipeDialog.ingredientQuantity", { index: idx + 1 })}
                        type="number"
                        step="0.05"
                        min="0.01"
                        value={ing.quantity}
                        onChange={(e) => {
                          const q = Math.max(0.001, parseFloat(e.target.value || "0"));
                          const chosen =
                            recipeStoreItems.find((i) => i.id === ing.inventoryItemId) ??
                            recipeStoreItems[0];
                          const updated = [...recipeFormData.ingredients];
                          const costs = chosen
                            ? calculateIngredientCost(chosen, q, ing.unit, ing.wastePercentage)
                            : { unitCostCents: 0, subtotalCostCents: 0 };
                          updated[idx] = {
                            ...ing,
                            quantity: q,
                            subtotalCostCents: costs.subtotalCostCents,
                          };
                          setRecipeFormData({ ...recipeFormData, ingredients: updated });
                        }}
                        className="h-8 text-xs"
                      />
                      <span className="shrink-0 text-muted-foreground">{unitLabel(ing.unit)}</span>
                    </div>
                    <div className="tabular col-span-2 text-right font-medium">
                      {costsVisible ? money(ing.subtotalCostCents) : "—"}
                    </div>
                    <div className="col-span-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={t("recipeDialog.removeIngredient", { name: ing.name })}
                        onClick={() => {
                          setRecipeFormData({
                            ...recipeFormData,
                            ingredients: recipeFormData.ingredients.filter((_, i) => i !== idx),
                          });
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <Label htmlFor="recipe-prep">{t("recipeDialog.prepInstructions")}</Label>
              <Input
                id="recipe-prep"
                placeholder={t("recipeDialog.prepPlaceholder")}
                value={recipeFormData.prepInstructions}
                onChange={(e) =>
                  setRecipeFormData({ ...recipeFormData, prepInstructions: e.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipeModalOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button onClick={handleSaveRecipeForm} disabled={busy} aria-busy={busy}>
              {t("recipeDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purchase receiving dialog */}
      <Dialog open={receiveModalOpen} onOpenChange={setReceiveModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("receiveDialog.title", { number: selectedPOForReceive?.poNumber ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("receiveDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            {selectedPOForReceive?.items.map((it) => {
              const currentInput = receiveInputs[it.id] ?? {
                qty: 0,
                price: Number(centsToDecimalString(it.unitPriceCents)),
                note: "",
              };
              return (
                <div key={it.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{it.name}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {t("receiveDialog.ordered", {
                          quantity: fmtQuantity(it.quantityOrdered, lng),
                          unit: unitLabel(it.unit),
                          received: fmtQuantity(it.quantityReceived, lng),
                        })}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {t("receiveDialog.agreedPrice", { price: money(it.unitPriceCents) })}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`recv-qty-${it.id}`} className="text-xs">
                        {t("receiveDialog.receivedNow")}
                      </Label>
                      <Input
                        id={`recv-qty-${it.id}`}
                        type="number"
                        step="0.5"
                        min="0"
                        max={it.quantityOrdered - it.quantityReceived}
                        value={currentInput.qty}
                        onChange={(e) => {
                          const v = Math.max(0, parseFloat(e.target.value || "0"));
                          setReceiveInputs({
                            ...receiveInputs,
                            [it.id]: { ...currentInput, qty: v },
                          });
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`recv-price-${it.id}`} className="text-xs">
                        {t("receiveDialog.verifiedPrice")}
                      </Label>
                      <Input
                        id={`recv-price-${it.id}`}
                        type="number"
                        step="0.10"
                        min="0"
                        value={currentInput.price}
                        onChange={(e) => {
                          const v = Math.max(0, parseFloat(e.target.value || "0"));
                          setReceiveInputs({
                            ...receiveInputs,
                            [it.id]: { ...currentInput, price: v },
                          });
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="recv-note">{t("receiveDialog.note")}</Label>
              <Input
                id="recv-note"
                placeholder={t("receiveDialog.notePlaceholder")}
                value={receivingNote}
                onChange={(e) => setReceivingNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveModalOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button disabled={busy} aria-busy={busy} onClick={handleConfirmReceive}>
              {t("receiveDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel purchase order confirmation */}
      <AlertDialog open={poToCancel !== null} onOpenChange={(o) => !o && setPoToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("purchases.cancelConfirmTitle", { number: poToCancel?.poNumber ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("purchases.cancelConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("purchases.keepOrder")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (poToCancel) void handleCancelPO(poToCancel);
              }}
            >
              {t("purchases.cancelConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stock movement dialog */}
      <Dialog open={movementModalOpen} onOpenChange={setMovementModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("moveDialog.title")}</DialogTitle>
            <DialogDescription>{t("moveDialog.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="move-item">{t("moveDialog.item")}</Label>
              <select
                id="move-item"
                value={selectedItemForMove?.id ?? ""}
                onChange={(e) => {
                  const itm = items.find((i) => i.id === e.target.value) ?? null;
                  setSelectedItemForMove(itm);
                  const target = org.locations.find(
                    (l) => l.id !== (itm?.locationId ?? defaultStore),
                  );
                  setTargetLocationId(target?.id ?? "");
                }}
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
              >
                {byStore(items, (i) => i.name).map((i) => (
                  <option key={i.id} value={i.id}>
                    {t("moveDialog.itemOption", {
                      name: showStore ? `${i.name} (${storeName(i.locationId)})` : i.name,
                      quantity: fmtQuantity(i.quantity, lng),
                      unit: unitLabel(i.unit),
                    })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium" id="move-type-label">
                {t("moveDialog.type")}
              </span>
              <div
                role="radiogroup"
                aria-labelledby="move-type-label"
                className="grid grid-cols-3 gap-1.5 sm:grid-cols-5"
              >
                {MOVE_TYPES.map((tType) => (
                  <Button
                    key={tType}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={moveType === tType}
                    variant={moveType === tType ? "secondary" : "outline"}
                    onClick={() => setMoveType(tType)}
                    className={
                      moveType === tType
                        ? "h-9 px-1 text-xs ring-1 ring-foreground/20"
                        : "h-9 px-1 text-xs"
                    }
                  >
                    {tType === "transfer" && <ArrowLeftRight className="mr-1 size-3" />}
                    {t(`moveDialog.types.${tType}`)}
                  </Button>
                ))}
              </div>
              {moveType === "loss" && (
                <p className="text-xs text-muted-foreground">{t("moveDialog.lossHint")}</p>
              )}
            </div>

            {moveType === "transfer" && (
              <div className="space-y-1.5">
                <Label htmlFor="move-target">{t("moveDialog.targetStore")}</Label>
                {transferTargets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("moveDialog.noTargetStore")}</p>
                ) : (
                  <select
                    id="move-target"
                    value={targetLocationId}
                    onChange={(e) => setTargetLocationId(e.target.value)}
                    className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                  >
                    {transferTargets.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="move-qty">
                {moveType === "adjustment"
                  ? t("moveDialog.countedQuantity")
                  : t("moveDialog.quantity")}
                {selectedItemForMove ? ` (${unitLabel(selectedItemForMove.unit)})` : ""}
              </Label>
              <Input
                id="move-qty"
                type="number"
                step="0.5"
                min="0.1"
                value={moveQty}
                onChange={(e) => setMoveQty(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="move-reason">{t("moveDialog.reason")}</Label>
              <Input
                id="move-reason"
                placeholder={t("moveDialog.reasonPlaceholder")}
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementModalOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleRecordMovement}
              disabled={
                busy ||
                !selectedItemForMove ||
                (moveType === "transfer" && transferTargets.length === 0)
              }
              aria-busy={busy}
            >
              {t("moveDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
