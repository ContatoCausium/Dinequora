import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  Archive,
  BookOpenText,
  ChefHat,
  Clock,
  Copy,
  Edit3,
  Eye,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Store,
  Trash2,
} from "lucide-react";

import {
  archiveOperationalMenu,
  fetchOperationalMenu,
  saveOperationalMenu,
} from "@/lib/operational.functions";
import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel, Segmented } from "@/components/app/page";
import { DemoBadge } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MenuCategory, MenuItem, ModifierGroup } from "@/lib/menu-service";
import { menuAbilities } from "@/lib/menu-abilities";
import { menuErrorKey, reportMenuError } from "@/lib/menu-errors";
import {
  canArchiveCategory,
  categoryIdFromName,
  categoryUsage,
  findCategoryCollision,
  hasActiveCategory,
  type ArchivedCategoryRef,
} from "@/lib/menu-categories";
import { cn } from "@/lib/utils";
import { fmtMoneyCents } from "@/lib/format";
import { centsFromNumberInput, centsToDecimalString } from "@/lib/money";

type LoadState = "loading" | "ready" | "error";
type StatusFilter = "all" | "active" | "inactive";
type CategoryForm = { mode: "new" | "edit"; id?: string; name: string; description: string };

/**
 * Menu & Products. Every write goes through the menu RPCs, which remain the authority
 * (permissions, store scope, owner-only categories and category_in_use, migrations 0018-0028);
 * this screen only offers what the member's role allows and explains every refusal.
 */
export function MenuPage() {
  const { t, i18n } = useTranslation("menu");
  const { org, locationId, role, can } = useWorkspace();
  const ability = useMemo(
    () => menuAbilities({ role, can, storeIds: org.locations.map((l) => l.id) }),
    [role, can, org.locations],
  );

  // ---------------------------------------------------------------- data
  const [state, setState] = useState<LoadState>("loading");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [archived, setArchived] = useState<ArchivedCategoryRef[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const applyMenu = useCallback((data: Awaited<ReturnType<typeof fetchOperationalMenu>>) => {
    setCategories(data.categories);
    setArchived(data.archivedCategories ?? []);
    setItems(data.items);
  }, []);
  const reload = useCallback(async () => {
    applyMenu(await fetchOperationalMenu({ data: { orgId: org.id } }));
  }, [applyMenu, org.id]);

  const load = useCallback(
    (isActive: () => boolean = () => true) => {
      setState("loading");
      fetchOperationalMenu({ data: { orgId: org.id } })
        .then((data) => {
          if (!isActive()) return;
          applyMenu(data);
          setState("ready");
        })
        .catch((error: unknown) => {
          if (!isActive()) return;
          reportMenuError("load", error);
          setState("error");
        });
    },
    [applyMenu, org.id],
  );
  useEffect(() => {
    let active = true;
    setCategories([]);
    setArchived([]);
    setItems([]);
    load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  /** Re-reads the menu after a write; a failed refresh is logged, never reported as a failed write. */
  const refresh = useCallback(
    () => reload().catch((error: unknown) => reportMenuError("reload", error)),
    [reload],
  );

  /**
   * Runs one write: a translated success message, or a translated refusal (the original code is
   * logged). The menu is reloaded after a refusal too, so the screen never shows a stale state.
   */
  async function run(action: string, work: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(action);
    try {
      try {
        await work();
      } catch (error) {
        reportMenuError(action, error);
        toast.error(t(menuErrorKey(error)));
        await refresh();
        return false;
      }
      toast.success(t(success));
      await refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------- filters
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  useEffect(() => {
    if (activeCategory !== "all" && !categories.some((c) => c.id === activeCategory))
      setActiveCategory("all");
  }, [categories, activeCategory]);

  const usage = useMemo(() => categoryUsage(items), [items]);
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (
        locationId !== "all" &&
        item.locationIds.length > 0 &&
        !item.locationIds.includes(locationId)
      )
        return false;
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (statusFilter === "active" && !item.active) return false;
      if (statusFilter === "inactive" && item.active) return false;
      if (!q) return true;
      const categoryName = categories.find((c) => c.id === item.category)?.name ?? "";
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        categoryName.toLowerCase().includes(q)
      );
    });
  }, [items, categories, locationId, activeCategory, statusFilter, search]);
  const filtersActive = search.trim() !== "" || activeCategory !== "all" || statusFilter !== "all";
  function clearFilters() {
    setSearch("");
    setActiveCategory("all");
    setStatusFilter("all");
  }

  // ---------------------------------------------------------------- products
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [removeItem, setRemoveItem] = useState<MenuItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formPrep, setFormPrep] = useState("10");
  const [formImage, setFormImage] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formModifiers, setFormModifiers] = useState<ModifierGroup[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  function openNewItem() {
    setEditingItem(null);
    setFormName("");
    setFormDesc("");
    setFormCategory(activeCategory !== "all" ? activeCategory : (categories[0]?.id ?? ""));
    setFormPrice("12.00");
    setFormPrep("10");
    setFormImage("");
    setFormActive(true);
    setFormModifiers([]);
    setFormError(null);
    setItemDialogOpen(true);
  }

  function openEditItem(item: MenuItem) {
    setEditingItem(item);
    setFormName(item.name);
    setFormDesc(item.description);
    // An archived (or missing) category is not offered: the member must choose an active one.
    setFormCategory(hasActiveCategory(item, categories) ? item.category : "");
    setFormPrice(centsToDecimalString(item.priceCents));
    setFormPrep(String(item.prepTimeMinutes));
    setFormImage(item.imageUrl || "");
    setFormActive(item.active);
    setFormModifiers(item.modifierGroups || []);
    setFormError(null);
    setItemDialogOpen(true);
  }

  async function handleSaveItem() {
    if (!formName.trim()) return setFormError(t("validation.nameRequired"));
    if (!categories.some((c) => c.id === formCategory))
      return setFormError(t("validation.categoryRequired"));
    const cents = centsFromNumberInput(formPrice || "0");
    if (cents === null) return setFormError(t("form.invalidPrice"));
    setFormError(null);
    const toSave: MenuItem = {
      id: editingItem?.id || `item-${crypto.randomUUID()}`,
      orgId: org.id,
      name: formName.trim(),
      description: formDesc.trim(),
      category: formCategory,
      priceCents: cents,
      prepTimeMinutes: Math.max(0, parseInt(formPrep || "0", 10) || 0),
      imageUrl: formImage.trim() || undefined,
      active: formActive,
      // Owners sell everywhere by default; a manager's new product is sold in their own stores.
      locationIds:
        editingItem?.locationIds ||
        (role === "owner"
          ? []
          : locationId === "all"
            ? org.locations.map((l) => l.id)
            : [locationId]),
      modifierGroups: formModifiers,
      createdAt: editingItem?.createdAt || new Date().toISOString(),
    };
    const ok = await run(
      "product.save",
      () => saveOperationalMenu({ data: { kind: "product", orgId: org.id, item: toSave } }),
      editingItem ? "toast.productUpdated" : "toast.productCreated",
    );
    if (ok) setItemDialogOpen(false);
  }

  function handleDuplicateItem(item: MenuItem) {
    void run(
      "product.duplicate",
      () =>
        saveOperationalMenu({
          data: {
            kind: "product",
            orgId: org.id,
            item: {
              ...item,
              id: `item-${crypto.randomUUID()}`,
              name: t("item.copyName", { name: item.name }),
            },
          },
        }),
      "toast.productDuplicated",
    );
  }

  function toggleItemActive(item: MenuItem) {
    void run(
      "product.availability",
      () =>
        saveOperationalMenu({
          data: { kind: "product", orgId: org.id, item: { ...item, active: !item.active } },
        }),
      item.active ? "toast.productUnavailable" : "toast.productAvailable",
    );
  }

  async function confirmRemoveItem() {
    if (!removeItem) return;
    const ok = await run(
      "product.archive",
      () => archiveOperationalMenu({ data: { orgId: org.id, kind: "product", id: removeItem.id } }),
      "toast.productArchived",
    );
    if (ok) setRemoveItem(null);
  }

  // ---------------------------------------------------------------- categories (owner only)
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MenuCategory | null>(null);

  function openNewCategory() {
    setCategoryError(null);
    setCategoryForm({ mode: "new", name: "", description: "" });
  }
  function openEditCategory(c: MenuCategory) {
    setCategoryError(null);
    setCategoryForm({ mode: "edit", id: c.id, name: c.name, description: c.description ?? "" });
  }

  async function handleSaveCategory() {
    if (!categoryForm) return;
    const name = categoryForm.name.trim();
    if (!name) return setCategoryError(t("validation.categoryNameRequired"));
    const id =
      categoryForm.mode === "edit" && categoryForm.id
        ? categoryForm.id
        : categoryIdFromName(name, () => `cat-${Date.now().toString(36)}`);
    // A new category must not silently overwrite (or re-activate) an existing one; a rename must
    // not take the name of another category, active or archived.
    const collision =
      categoryForm.mode === "edit"
        ? findCategoryCollision(
            name,
            null,
            categories.filter((c) => c.id !== id),
            archived,
          )
        : findCategoryCollision(name, id, categories, archived);
    if (collision.kind === "active")
      return setCategoryError(t("validation.categoryExists", { name: collision.category.name }));
    if (collision.kind === "archived")
      return setCategoryError(
        t("validation.categoryArchivedExists", { name: collision.category.name }),
      );
    setCategoryError(null);
    const description = categoryForm.description.trim();
    const ok = await run(
      categoryForm.mode === "edit" ? "category.update" : "category.create",
      () =>
        saveOperationalMenu({
          data: {
            kind: "category",
            orgId: org.id,
            category: { id, name, ...(description ? { description } : {}) },
          },
        }),
      categoryForm.mode === "edit" ? "toast.categoryUpdated" : "toast.categoryCreated",
    );
    if (ok) setCategoryForm(null);
  }

  async function confirmArchiveCategory() {
    if (!archiveTarget) return;
    const ok = await run(
      "category.archive",
      () =>
        archiveOperationalMenu({
          data: { orgId: org.id, kind: "category", id: archiveTarget.id },
        }),
      "toast.categoryArchived",
    );
    if (ok) setArchiveTarget(null);
  }

  function reactivateCategory(c: ArchivedCategoryRef) {
    // Saving an existing category re-activates it (the upsert sets active = true by default).
    void run(
      "category.reactivate",
      () =>
        saveOperationalMenu({
          data: {
            kind: "category",
            orgId: org.id,
            category: {
              id: c.id,
              name: c.name,
              ...(c.description ? { description: c.description } : {}),
            },
          },
        }),
      "toast.categoryReactivated",
    );
  }

  function addModifierGroup() {
    const stamp = crypto.randomUUID();
    setFormModifiers([
      ...formModifiers,
      {
        id: `mg-${stamp}`,
        name: t("form.defaultGroupName"),
        required: false,
        minSelections: 0,
        maxSelections: 1,
        options: [{ id: `opt-${stamp}`, name: t("form.defaultOptionName"), priceCents: 0 }],
      },
    ]);
  }

  const [previewOpen, setPreviewOpen] = useState(false);
  const noCategories = state === "ready" && categories.length === 0;

  // ---------------------------------------------------------------- render
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <span className="eyebrow">{org.name}</span>
            {org.fictional && <DemoBadge label={t("interactiveBadge")} />}
          </div>
        }
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-1.5 size-4" aria-hidden />
              {t("preview")}
            </Button>
            {ability.manageCategories && (
              <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
                <Layers className="mr-1.5 size-4" aria-hidden />
                {t("manageCategories")}
              </Button>
            )}
            {ability.createProducts && (
              <Button size="sm" onClick={openNewItem} disabled={state !== "ready" || noCategories}>
                <Plus className="mr-1.5 size-4" aria-hidden />
                {t("newProduct")}
              </Button>
            )}
          </div>
        }
      />

      {!ability.anyWrite && <Notice>{t("readOnlyNotice")}</Notice>}
      {ability.anyWrite && !ability.manageCategories && (
        <Notice>{t("categoriesOwnerOnlyNotice")}</Notice>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-80">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Segmented<StatusFilter>
            label={t("filters.status")}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: t("filters.all") },
              { value: "active", label: t("filters.available") },
              { value: "inactive", label: t("filters.unavailable") },
            ]}
          />
        </div>
        <div
          role="group"
          aria-label={t("categoryFilterLabel")}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0"
        >
          <Button
            variant={activeCategory === "all" ? "default" : "secondary"}
            size="sm"
            aria-pressed={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
            className="h-8 shrink-0 text-xs"
          >
            {t("allCategories")}
          </Button>
          {categories.map((c) => (
            <Button
              key={c.id}
              variant={activeCategory === c.id ? "default" : "secondary"}
              size="sm"
              aria-pressed={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
              className="h-8 shrink-0 text-xs"
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      {state === "loading" ? (
        <div role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t("states.loading")}</span>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="surface overflow-hidden" aria-hidden>
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : state === "error" ? (
        <Panel className="p-10 text-center">
          <AlertCircle className="mx-auto size-10 text-destructive/70" aria-hidden />
          <h2 className="mt-4 text-base font-semibold">{t("states.loadErrorTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("states.loadErrorBody")}</p>
          <Button size="sm" variant="outline" onClick={() => load()} className="mt-4">
            <RefreshCw className="mr-1.5 size-4" aria-hidden />
            {t("states.retry")}
          </Button>
        </Panel>
      ) : items.length === 0 ? (
        <Panel className="p-12 text-center">
          <BookOpenText className="mx-auto size-12 text-muted-foreground/50" aria-hidden />
          <h2 className="mt-4 text-base font-semibold">{t("states.emptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {noCategories
              ? ability.manageCategories
                ? t("states.emptyNoCategoriesBody")
                : t("states.emptyNoCategoriesStaff")
              : t("states.emptyBody")}
          </p>
          {noCategories && ability.manageCategories ? (
            <Button size="sm" onClick={openNewCategory} className="mt-4">
              <Plus className="mr-1.5 size-4" aria-hidden />
              {t("states.createCategoryFirst")}
            </Button>
          ) : (
            !noCategories &&
            ability.createProducts && (
              <Button size="sm" onClick={openNewItem} className="mt-4">
                <Plus className="mr-1.5 size-4" aria-hidden />
                {t("newProduct")}
              </Button>
            )
          )}
        </Panel>
      ) : filteredItems.length === 0 ? (
        <Panel className="p-10 text-center">
          <Search className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
          <h2 className="mt-4 text-base font-semibold">{t("states.filteredEmptyTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("states.filteredEmptyBody")}</p>
          {filtersActive && (
            <Button size="sm" variant="outline" onClick={clearFilters} className="mt-4">
              {t("states.clearFilters")}
            </Button>
          )}
        </Panel>
      ) : (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label={t("products")}
        >
          {filteredItems.map((item) => {
            const cat = categories.find((c) => c.id === item.category);
            const categoryOk = hasActiveCategory(item, categories);
            const touchable = ability.canTouchProduct(item);
            const working = busy !== null;
            return (
              <li
                key={item.id}
                className={cn(
                  "surface group flex flex-col overflow-hidden transition-shadow hover:shadow-pop",
                  !item.active && "opacity-80",
                )}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground/40">
                      <ChefHat className="size-8" strokeWidth={1.5} aria-hidden />
                    </div>
                  )}
                  <Badge
                    variant={item.active ? "success" : "neutral"}
                    className="absolute left-3 top-3 bg-card/90 backdrop-blur-sm"
                  >
                    {item.active ? t("item.available") : t("item.unavailable")}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  {cat ? (
                    <p className="eyebrow mb-1 truncate">{cat.name}</p>
                  ) : (
                    <Badge variant="warning" className="mb-1.5 w-fit">
                      {t("item.categoryArchived")}
                    </Badge>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold leading-snug">{item.name}</h3>
                    <span className="tabular shrink-0 font-semibold">
                      {fmtMoneyCents(item.priceCents, i18n.language)}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" aria-hidden />
                      {t("item.prepTime", { min: item.prepTimeMinutes })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Store className="size-3.5" aria-hidden />
                      {item.locationIds.length === 0
                        ? t("item.allStores")
                        : t("item.stores", { count: item.locationIds.length })}
                    </span>
                  </div>

                  {!categoryOk && ability.anyWrite && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("item.categoryArchivedHint")}
                    </p>
                  )}
                  {ability.anyWrite && !touchable && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("item.notInYourStores")}
                    </p>
                  )}

                  {ability.anyWrite && touchable && (
                    <div className="mt-3 flex items-center justify-between gap-1.5 border-t pt-3">
                      {ability.editProducts ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={working || (!item.active && !categoryOk)}
                          onClick={() => toggleItemActive(item)}
                        >
                          {item.active ? t("item.markUnavailable") : t("item.markAvailable")}
                        </Button>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-0.5">
                        {ability.createProducts && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("item.duplicateLabel", { name: item.name })}
                            title={t("item.duplicate")}
                            disabled={working || !categoryOk}
                            onClick={() => handleDuplicateItem(item)}
                          >
                            <Copy className="size-4" aria-hidden />
                          </Button>
                        )}
                        {ability.editProducts && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("item.editLabel", { name: item.name })}
                            title={t("item.edit")}
                            disabled={working}
                            onClick={() => openEditItem(item)}
                          >
                            <Edit3 className="size-4" aria-hidden />
                          </Button>
                        )}
                        {ability.archiveProducts && item.active && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t("item.deleteLabel", { name: item.name })}
                            title={t("item.delete")}
                            disabled={working}
                            onClick={() => setRemoveItem(item)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Categories (owner only) */}
      <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageCategories")}</DialogTitle>
            <DialogDescription>{t("categoriesDialog.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-1">
            <div className="flex justify-end">
              <Button size="sm" onClick={openNewCategory} disabled={busy !== null}>
                <Plus className="mr-1 size-3.5" aria-hidden />
                {t("newCategory")}
              </Button>
            </div>

            <section aria-labelledby="menu-categories-active">
              <h3 id="menu-categories-active" className="eyebrow mb-2">
                {t("categoriesDialog.activeHeading")}
              </h3>
              {categories.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  {t("categoriesDialog.noActive")}
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {categories.map((c) => {
                    const u = usage.get(c.id);
                    const archivable = canArchiveCategory(u);
                    return (
                      <li key={c.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("categoriesDialog.products", { count: u?.total ?? 0 })}
                            {(u?.active ?? 0) > 0 && (
                              <>
                                {" "}
                                · {t("categoriesDialog.activeProducts", { count: u?.active ?? 0 })}
                              </>
                            )}
                          </p>
                          {c.description && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {c.description}
                            </p>
                          )}
                          {!archivable && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("categoriesDialog.inUseHint", { count: u?.active ?? 0 })}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("categoriesDialog.edit", { name: c.name })}
                            title={t("categoriesDialog.edit", { name: c.name })}
                            disabled={busy !== null}
                            onClick={() => openEditCategory(c)}
                          >
                            <Edit3 className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t("categoriesDialog.archive", { name: c.name })}
                            title={t("categoriesDialog.archive", { name: c.name })}
                            disabled={busy !== null || !archivable}
                            onClick={() => setArchiveTarget(c)}
                          >
                            <Archive className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="menu-categories-archived">
              <h3 id="menu-categories-archived" className="eyebrow mb-2">
                {t("categoriesDialog.archivedHeading")}
              </h3>
              {archived.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("categoriesDialog.noArchived")}</p>
              ) : (
                <ul className="divide-y rounded-md border bg-muted/30">
                  {archived.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-muted-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("categoriesDialog.products", { count: c.productCount })}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t("categoriesDialog.reactivateLabel", { name: c.name })}
                        disabled={busy !== null}
                        onClick={() => reactivateCategory(c)}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                        {t("categoriesDialog.reactivate")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoriesOpen(false)}>
              {t("categoriesDialog.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category create / edit */}
      <Dialog open={categoryForm !== null} onOpenChange={(open) => !open && setCategoryForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {categoryForm?.mode === "edit"
                ? t("categoryForm.titleEdit")
                : t("categoryForm.title")}
            </DialogTitle>
            <DialogDescription>{t("categoriesDialog.subtitle")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveCategory();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="menu-category-name">{t("categoryForm.name")}</Label>
              <Input
                id="menu-category-name"
                value={categoryForm?.name ?? ""}
                onChange={(e) => setCategoryForm((f) => (f ? { ...f, name: e.target.value } : f))}
                aria-invalid={categoryError !== null}
                aria-describedby={categoryError ? "menu-category-error" : undefined}
                maxLength={160}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="menu-category-description">{t("categoryForm.description")}</Label>
              <Input
                id="menu-category-description"
                value={categoryForm?.description ?? ""}
                onChange={(e) =>
                  setCategoryForm((f) => (f ? { ...f, description: e.target.value } : f))
                }
              />
            </div>
            {categoryError && (
              <p id="menu-category-error" role="alert" className="text-sm text-destructive">
                {categoryError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCategoryForm(null)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "category.create" || busy === "category.update"
                  ? t("form.saving")
                  : categoryForm?.mode === "edit"
                    ? t("categoryForm.saveEdit")
                    : t("categoryForm.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Archive category confirmation */}
      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("archiveCategory.title", { name: archiveTarget?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("archiveCategory.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmArchiveCategory()}
            >
              {t("archiveCategory.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product create / edit */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? t("form.titleEdit") : t("form.titleNew")}</DialogTitle>
            <DialogDescription>{t("form.subtitle")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveItem();
            }}
          >
            {editingItem && !hasActiveCategory(editingItem, categories) && (
              <Notice>{t("form.categoryArchivedNotice")}</Notice>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="menu-item-name">{t("form.name")}</Label>
              <Input
                id="menu-item-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={160}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="menu-item-description">{t("form.description")}</Label>
              <Input
                id="menu-item-description"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="menu-item-category">{t("form.category")}</Label>
                <select
                  id="menu-item-category"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                >
                  <option value="" disabled>
                    {t("form.selectCategory")}
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="menu-item-price">{t("form.price")}</Label>
                <Input
                  id="menu-item-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="menu-item-prep">{t("form.prepTime")}</Label>
                <Input
                  id="menu-item-prep"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={formPrep}
                  onChange={(e) => setFormPrep(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="menu-item-image">{t("form.imageUrl")}</Label>
                <Input
                  id="menu-item-image"
                  type="url"
                  placeholder={t("form.imageUrlPlaceholder")}
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between pb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("form.modifierGroups")}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={addModifierGroup}>
                  <Plus className="mr-1 size-3.5" aria-hidden />
                  {t("form.addGroup")}
                </Button>
              </div>

              {formModifiers.map((group, gIdx) => (
                <div key={group.id} className="mb-3 space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      aria-label={t("form.groupName")}
                      value={group.name}
                      onChange={(e) => {
                        const next = [...formModifiers];
                        const g = next[gIdx];
                        if (g) next[gIdx] = { ...g, name: e.target.value };
                        setFormModifiers(next);
                      }}
                      className="h-8 text-sm font-semibold"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      aria-label={t("form.removeGroup")}
                      onClick={() => setFormModifiers(formModifiers.filter((_, i) => i !== gIdx))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={group.required}
                      onChange={(e) => {
                        const next = [...formModifiers];
                        const g = next[gIdx];
                        if (g) next[gIdx] = { ...g, required: e.target.checked };
                        setFormModifiers(next);
                      }}
                    />
                    {t("form.groupRequired")}
                  </label>
                </div>
              ))}
            </div>

            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setItemDialogOpen(false)}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "product.save" ? t("form.saving") : t("form.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove product confirmation */}
      <Dialog open={removeItem !== null} onOpenChange={(open) => !open && setRemoveItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteSafeTitle", { name: removeItem?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("deleteSafePrompt")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setRemoveItem(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void confirmRemoveItem()}
            >
              {t("item.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("previewModal.title")}</DialogTitle>
            <DialogDescription>{t("previewModal.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {items.every((i) => !i.active || !hasActiveCategory(i, categories)) && (
              <p className="text-center text-sm text-muted-foreground">{t("previewModal.empty")}</p>
            )}
            {categories.map((c) => {
              const catItems = items.filter((i) => i.category === c.id && i.active);
              if (catItems.length === 0) return null;
              return (
                <div key={c.id} className="space-y-3">
                  <div className="border-b pb-1">
                    <h4 className="text-lg font-bold">{c.name}</h4>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {catItems.map((item) => (
                      <div key={item.id} className="flex gap-3 rounded-lg border bg-card p-3">
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-20 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col justify-between">
                          <div>
                            <p className="truncate text-sm font-semibold">{item.name}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          <p className="mt-2 text-sm font-bold text-primary">
                            {fmtMoneyCents(item.priceCents, i18n.language)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground">
      <AlertCircle className="size-4 shrink-0 text-warning" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
