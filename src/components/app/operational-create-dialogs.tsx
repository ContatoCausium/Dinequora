import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { saveOperationalRecord } from "@/lib/operational.functions";
import type { InventoryItem } from "@/lib/inventory-service";
import type { Supplier } from "@/lib/suppliers-purchases-service";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OperationalCreateDialog({
  kind,
  open,
  onOpenChange,
  orgId,
  locationId,
  items,
  suppliers,
  onSaved,
}: {
  kind: "inventory" | "supplier" | "purchase";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  locationId: string | undefined;
  items: InventoryItem[];
  suppliers: Supplier[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation("operations");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("0");
  const [unit, setUnit] = useState("units");
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [shipping, setShipping] = useState("0");
  async function save() {
    if (busy) return;
    const q = Number(quantity);
    const cents = Math.round(Number(price) * 100);
    const chosen = items.find((i) => i.id === (itemId || items[0]?.id));
    const sup = supplierId || suppliers[0]?.id;
    if (!Number.isFinite(q) || q < 0 || !Number.isSafeInteger(cents) || cents < 0) {
      toast.error(t("invalid"));
      return;
    }
    if (kind !== "supplier" && !locationId) {
      toast.error(t("storeRequired"));
      return;
    }
    const payload =
      kind === "inventory"
        ? {
            name,
            category: "dry_goods",
            sku: "",
            unit,
            quantity: q,
            minQuantity: 0,
            costCents: cents,
            supplier: "",
            active: true,
          }
        : kind === "supplier"
          ? { name, contactName: contact, active: true, suppliedCategories: [] }
          : {
              supplierId: sup ?? "",
              status: "sent",
              discountCents: Math.round(Number(discount) * 100),
              taxCents: Math.round(Number(tax) * 100),
              shippingCents: Math.round(Number(shipping) * 100),
              items: [
                { inventoryItemId: chosen?.id ?? "", quantityOrdered: q, unitPriceCents: cents },
              ],
            };
    setBusy(true);
    try {
      await saveOperationalRecord({
        data: { orgId, ...(locationId ? { locationId } : {}), kind, payload },
      });
      await onSaved();
      onOpenChange(false);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`create.${kind}`)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {kind !== "purchase" && (
            <div>
              <Label htmlFor={`new-${kind}-name`}>{t("name")}</Label>
              <Input
                id={`new-${kind}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          {kind === "supplier" && (
            <div>
              <Label htmlFor="supplier-contact">{t("contact")}</Label>
              <Input
                id="supplier-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
          )}
          {kind === "purchase" && (
            <>
              <div>
                <Label htmlFor="po-supplier">{t("supplier")}</Label>
                <select
                  id="po-supplier"
                  className="h-9 w-full rounded-md border bg-background px-3"
                  value={supplierId || suppliers[0]?.id || ""}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  {suppliers
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label htmlFor="po-item">{t("item")}</Label>
                <select
                  id="po-item"
                  className="h-9 w-full rounded-md border bg-background px-3"
                  value={itemId || items[0]?.id || ""}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {kind !== "supplier" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="op-qty">{t("quantity")}</Label>
                <Input
                  id="op-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="op-price">{t("unitPrice")}</Label>
                <Input
                  id="op-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
          )}
          {kind === "inventory" && (
            <div>
              <Label htmlFor="op-unit">{t("unit")}</Label>
              <select
                id="op-unit"
                className="h-9 w-full rounded-md border bg-background px-3"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {["units", "pack", "lb", "oz", "kg", "gal"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          )}
          {kind === "purchase" && (
            <div className="grid grid-cols-3 gap-2">
              {[
                ["discount", discount, setDiscount],
                ["tax", tax, setTax],
                ["shipping", shipping, setShipping],
              ].map(([key, value, setter]) =>
                typeof key === "string" &&
                typeof value === "string" &&
                typeof setter === "function" ? (
                  <div key={key}>
                    <Label htmlFor={`po-${key}`}>{t(key)}</Label>
                    <Input
                      id={`po-${key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                    />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={busy} onClick={save}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
