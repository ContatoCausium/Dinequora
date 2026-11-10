import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import {
  fetchOperationalMenu,
  saveOperationalMenu,
  archiveOperationalMenu,
} from "@/lib/operational.functions";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BookOpenText,
  Plus,
  Search,
  Eye,
  Sparkles,
  Copy,
  Clock,
  Trash2,
  Edit3,
  Check,
  DollarSign,
  Store,
  Layers,
  ChefHat,
  AlertCircle,
} from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listCategories,
  saveCategory,
  deleteCategory,
  listMenuItems,
  saveMenuItem,
  deleteMenuItem,
  duplicateMenuItem,
  type MenuItem,
  type MenuCategory,
  type ModifierGroup,
  type ModifierOption,
} from "@/lib/menu-service";
import { DemoBadge } from "@/components/app/brand-mark";
import { cn } from "@/lib/utils";
import { fmtMoneyCents } from "@/lib/format";
import { centsFromNumberInput, centsToDecimalString } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/_app/menu")({
  head: () => ({
    meta: [
      { title: "Menu & Products · Dinequora" },
      {
        name: "description",
        content: "Restaurant products, prices and modifiers with authorized store access.",
      },
      { property: "og:title", content: "Menu & Products · Dinequora" },
      {
        property: "og:description",
        content: "Restaurant products, prices and modifiers with authorized store access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const { t, i18n } = useTranslation("menu");
  const { org, locationId, role, can, canAny } = useWorkspace();
  const canManage = canAny(["menu.create", "menu.edit", "menu.delete"]);
  const canCreate = can("menu.create");
  const canEdit = can("menu.edit");
  const canDelete = can("menu.delete");
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);
  async function guarded(action: () => void | Promise<void>) {
    try {
      await action();
    } catch (e) {
      toast.error(
        e instanceof Error && e.message === "location_forbidden"
          ? "Not allowed for your stores"
          : "Action could not be completed",
      );
    }
  }

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [saving, setSaving] = useState(false);
  async function reloadMenu() {
    const data = await fetchOperationalMenu({ data: { orgId: org.id } });
    setCategories(data.categories);
    setItems(data.items);
  }
  useEffect(() => {
    let active = true;
    setCategories([]);
    setItems([]);
    fetchOperationalMenu({ data: { orgId: org.id } })
      .then((data) => {
        if (active) {
          setCategories(data.categories);
          setItems(data.items);
        }
      })
      .catch(() => {
        if (active) toast.error(t("common:states.errorTitle"));
      });
    return () => {
      active = false;
    };
  }, [org.id]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catManageOpen, setCatManageOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Category Form State
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");

  // Item Form State
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formPrep, setFormPrep] = useState("10");
  const [formImage, setFormImage] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formModifiers, setFormModifiers] = useState<ModifierGroup[]>([]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (
        locationId !== "all" &&
        item.locationIds.length > 0 &&
        !item.locationIds.includes(locationId)
      ) {
        return false;
      }
      if (activeCategory !== "all" && item.category !== activeCategory) {
        return false;
      }
      if (statusFilter === "active" && !item.active) return false;
      if (statusFilter === "inactive" && item.active) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, locationId, activeCategory, statusFilter, search]);

  function openNewItem() {
    setEditingItem(null);
    setFormName("");
    setFormDesc("");
    setFormCategory(categories[0]?.id || "default");
    setFormPrice("12.00");
    setFormPrep("10");
    setFormImage("");
    setFormActive(true);
    setFormModifiers([]);
    setItemDialogOpen(true);
  }

  function openEditItem(item: MenuItem) {
    setEditingItem(item);
    setFormName(item.name);
    setFormDesc(item.description);
    setFormCategory(item.category);
    setFormPrice(centsToDecimalString(item.priceCents));
    setFormPrep(String(item.prepTimeMinutes));
    setFormImage(item.imageUrl || "");
    setFormActive(item.active);
    setFormModifiers(item.modifierGroups || []);
    setItemDialogOpen(true);
  }

  function handleSaveItem() {
    if (!formName.trim()) {
      toast.error("Item name is required");
      return;
    }
    const cents = centsFromNumberInput(formPrice || "0"); // <input type="number">
    if (cents === null) {
      toast.error(t("form.invalidPrice"));
      return;
    }
    const prep = parseInt(formPrep || "5", 10);

    const toSave: MenuItem = {
      id: editingItem?.id || `item-${Date.now()}`,
      orgId: org.id,
      name: formName.trim(),
      description: formDesc.trim(),
      category: formCategory || categories[0]?.id || "default",
      priceCents: cents,
      prepTimeMinutes: prep,
      imageUrl: formImage.trim() || undefined,
      active: formActive,
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

    if (saving) return;
    guarded(async () => {
      setSaving(true);
      try {
        await saveOperationalMenu({ data: { kind: "product", orgId: org.id, item: toSave } });
        await reloadMenu();
        setItemDialogOpen(false);
        toast.success(editingItem ? "Product updated" : "Product created");
      } finally {
        setSaving(false);
      }
    });
  }

  function confirmDeleteItem(id: string) {
    if (!canManage) return;
    guarded(async () => {
      await archiveOperationalMenu({ data: { orgId: org.id, kind: "product", id } });
      await reloadMenu();
      setDeleteConfirmId(null);
      toast.success("Product removed");
    });
  }

  function handleDuplicateItem(id: string) {
    if (!canManage) return;
    guarded(async () => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      await saveOperationalMenu({
        data: {
          kind: "product",
          orgId: org.id,
          item: { ...item, id: `item-${crypto.randomUUID()}`, name: `${item.name} (Copy)` },
        },
      });
      await reloadMenu();
      toast.success("Product duplicated");
    });
  }

  function toggleItemActive(item: MenuItem) {
    if (!canManage) return;
    guarded(async () => {
      await saveOperationalMenu({
        data: { kind: "product", orgId: org.id, item: { ...item, active: !item.active } },
      });
      await reloadMenu();
      toast.success(item.active ? "Product set to unavailable" : "Product is now available");
    });
  }

  function handleDeleteCategory(id: string) {
    if (!canManage) return;
    guarded(async () => {
      await archiveOperationalMenu({ data: { orgId: org.id, kind: "category", id } });
      await reloadMenu();
      if (activeCategory === id) setActiveCategory("all");
      toast.success("Category deleted");
    });
  }

  async function handleSaveCategory() {
    if (!catName.trim()) return;
    const catId = catName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const newCat: MenuCategory = {
      id: catId || `cat-${Date.now()}`,
      name: catName.trim(),
      description: catDesc.trim() || undefined,
    };
    if (saving) return;
    setSaving(true);
    try {
      await saveOperationalMenu({ data: { kind: "category", orgId: org.id, category: newCat } });
      await reloadMenu();
    } catch {
      toast.error("Not allowed for your stores");
      return;
    } finally {
      setSaving(false);
    }
    setCatDialogOpen(false);
    setCatName("");
    setCatDesc("");
    toast.success("Category added");
  }

  function addModifierGroup() {
    const newGroup: ModifierGroup = {
      id: `mg-${Date.now()}`,
      name: "Choose Option",
      required: false,
      minSelections: 0,
      maxSelections: 1,
      options: [{ id: `opt-${Date.now()}`, name: "Regular", priceCents: 0 }],
    };
    setFormModifiers([...formModifiers, newGroup]);
  }

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
              <Eye className="mr-1.5 size-4" />
              {t("preview")}
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setCatManageOpen(true)}>
                  <Layers className="mr-1.5 size-4" />
                  {t("manageCategories")}
                </Button>
                <Button size="sm" onClick={openNewItem}>
                  <Plus className="mr-1.5 size-4" />
                  {t("newProduct")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {!canManage && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="size-4 text-warning shrink-0" />
          <span>{t("readOnlyNotice")}</span>
        </div>
      )}

      {/* Filter and Category Pills */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={activeCategory === "all" ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveCategory("all")}
            className="text-xs h-8"
          >
            {t("allCategories")}
          </Button>
          {categories.map((c) => (
            <Button
              key={c.id}
              variant={activeCategory === c.id ? "default" : "secondary"}
              size="sm"
              onClick={() => setActiveCategory(c.id)}
              className="text-xs h-8"
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid of Menu Items */}
      {filteredItems.length === 0 ? (
        <Panel className="p-12 text-center">
          <BookOpenText className="mx-auto size-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-base font-semibold">Nenhum produto cadastrado no cardápio</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre categorias e itens reais no banco de dados para disponibilizar no POS e
            atendimento.
          </p>
          {canManage && (
            <Button size="sm" onClick={openNewItem} className="mt-4">
              <Plus className="mr-1.5 size-4" />
              {t("newProduct")}
            </Button>
          )}
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const cat = categories.find((c) => c.id === item.category);
            return (
              <article
                key={item.id}
                className={cn(
                  "surface group flex flex-col overflow-hidden transition-shadow hover:shadow-pop",
                  !item.active && "opacity-75",
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
                      <ChefHat className="size-8" strokeWidth={1.5} />
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
                  {cat && <p className="eyebrow mb-1 truncate">{cat.name}</p>}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold leading-snug">{item.name}</h3>
                    <span className="tabular shrink-0 font-semibold">
                      {fmtMoneyCents(item.priceCents, i18n.language)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>

                  <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {t("item.prepTime", { min: item.prepTimeMinutes })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Store className="size-3.5" />
                      {item.locationIds.length === 0
                        ? t("item.allStores")
                        : t("item.stores", { count: item.locationIds.length })}
                    </span>
                  </div>

                  {canManage && (
                    <div className="mt-3 flex items-center justify-between gap-1.5 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canEdit}
                        onClick={() => toggleItemActive(item)}
                      >
                        {item.active ? t("item.markUnavailable") : t("item.markAvailable")}
                      </Button>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t("item.duplicate")}
                          title={t("item.duplicate")}
                          disabled={!canCreate}
                          onClick={() => handleDuplicateItem(item.id)}
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t("item.edit")}
                          title={t("item.edit")}
                          disabled={!canEdit}
                          onClick={() => openEditItem(item)}
                        >
                          <Edit3 className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t("item.delete")}
                          title={t("item.delete")}
                          disabled={!canDelete}
                          onClick={() => setDeleteConfirmId(item.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Manage Categories Dialog */}
      <Dialog open={catManageOpen} onOpenChange={setCatManageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("manageCategories")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCatDialogOpen(true)}>
                <Plus className="mr-1 size-3.5" />
                {t("newCategory")}
              </Button>
            </div>
            <div className="divide-y rounded-md border">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    )}
                  </div>
                  {canManage && categories.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      onClick={() => handleDeleteCategory(c.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatManageOpen(false)}>
              {t("form.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Creation Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("categoryForm.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("categoryForm.name")}</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t("categoryForm.description")}</Label>
              <Input value={catDesc} onChange={(e) => setCatDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button disabled={saving} onClick={handleSaveCategory}>
              {t("categoryForm.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Edit / Creation Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? t("form.titleEdit") : t("form.titleNew")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("form.name")}</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("form.description")}</Label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("form.category")}</Label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("form.price")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("form.prepTime")}</Label>
                <Input
                  type="number"
                  value={formPrep}
                  onChange={(e) => setFormPrep(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("form.imageUrl")}</Label>
                <Input
                  placeholder="https://images.unsplash.com/..."
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                />
              </div>
            </div>

            {/* Modifier Groups Section */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between pb-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("form.modifierGroups")}
                </Label>
                <Button type="button" variant="ghost" size="sm" onClick={addModifierGroup}>
                  <Plus className="mr-1 size-3.5" />
                  {t("form.addGroup")}
                </Button>
              </div>

              {formModifiers.map((group, gIdx) => (
                <div key={group.id} className="mb-3 rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={group.name}
                      onChange={(e) => {
                        const next = [...formModifiers];
                        const g = next[gIdx];
                        if (g) g.name = e.target.value;
                        setFormModifiers(next);
                      }}
                      className="h-8 text-sm font-semibold"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      onClick={() => setFormModifiers(formModifiers.filter((_, i) => i !== gIdx))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={group.required}
                        onChange={(e) => {
                          const next = [...formModifiers];
                          const g = next[gIdx];
                          if (g) g.required = e.target.checked;
                          setFormModifiers(next);
                        }}
                      />
                      {t("form.groupRequired")}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button disabled={saving} onClick={handleSaveItem}>
              {t("form.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Item Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("item.delete")}</DialogTitle>
            <DialogDescription>{t("deleteSafePrompt")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && confirmDeleteItem(deleteConfirmId)}
            >
              {t("item.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live Customer Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("previewModal.title")}</DialogTitle>
            <DialogDescription>{t("previewModal.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {categories.map((c) => {
              const catItems = items.filter((i) => i.category === c.id && i.active);
              if (catItems.length === 0) return null;
              return (
                <div key={c.id} className="space-y-3">
                  <div className="border-b pb-1">
                    <h4 className="font-bold text-lg">{c.name}</h4>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {catItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex gap-3 rounded-lg border p-3 bg-card hover:border-primary transition-colors cursor-pointer"
                      >
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-20 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <div className="flex flex-col justify-between flex-1 min-w-0">
                          <div>
                            <p className="font-semibold text-sm truncate">{item.name}</p>
                            <p className="line-clamp-2 text-xs text-muted-foreground mt-0.5">
                              {item.description}
                            </p>
                          </div>
                          <p className="font-bold text-sm text-primary mt-2">
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
