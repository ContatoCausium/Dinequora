import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseCategory,
  type ExpenseRecurrence,
  type ExpenseStatus,
} from "@/lib/finance-service";
import type { ExpenseFormValues } from "./finance-model";

export function ExpenseFormDialog({
  open,
  onOpenChange,
  editing,
  initial,
  stores,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Expense | null;
  initial: ExpenseFormValues;
  stores: { id: string; name: string }[];
  saving: boolean;
  onSubmit: (values: ExpenseFormValues) => void;
}) {
  const { t } = useTranslation("finance");
  const id = useId();
  const [v, setV] = useState<ExpenseFormValues>(initial);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);
  const set = <K extends keyof ExpenseFormValues>(k: K, value: ExpenseFormValues[K]) =>
    setV((cur) => ({ ...cur, [k]: value }));

  // New records use the split categories; legacy "utilities" stays selectable only on records that have it.
  const categories = EXPENSE_CATEGORIES.filter(
    (c) => c !== "utilities" || editing?.category === "utilities",
  );
  const storeLocked = editing !== null || stores.length === 1;
  const field = "mt-1 h-9";
  const select = "mt-1 h-9 w-full rounded-md border bg-background px-2.5 text-sm text-foreground";
  const label = "text-xs font-medium text-foreground";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(v);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
            <DialogDescription>{t("form.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div>
              <label htmlFor={`${id}-store`} className={label}>
                {t("form.store")}
              </label>
              <select
                id={`${id}-store`}
                value={v.locationId}
                disabled={storeLocked}
                onChange={(e) => set("locationId", e.target.value)}
                className={select}
                required
              >
                {!v.locationId && <option value="">{t("form.storePlaceholder")}</option>}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {editing && (
                <p className="mt-1 text-[11px] text-muted-foreground">{t("form.storeLocked")}</p>
              )}
            </div>

            <div>
              <label htmlFor={`${id}-desc`} className={label}>
                {t("form.description")}
              </label>
              <Input
                id={`${id}-desc`}
                value={v.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={t("form.descriptionPlaceholder")}
                className={field}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-amount`} className={label}>
                  {t("form.amount")}
                </label>
                <Input
                  id={`${id}-amount`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={v.amount}
                  onChange={(e) => set("amount", e.target.value)}
                  placeholder={t("form.amountPlaceholder")}
                  className={`${field} tabular`}
                  required
                />
              </div>
              <div>
                <label htmlFor={`${id}-due`} className={label}>
                  {t("form.dueDate")}
                </label>
                <Input
                  id={`${id}-due`}
                  type="date"
                  value={v.dueDate}
                  onChange={(e) => set("dueDate", e.target.value)}
                  className={field}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-cat`} className={label}>
                  {t("form.category")}
                </label>
                <select
                  id={`${id}-cat`}
                  value={v.category}
                  onChange={(e) => set("category", e.target.value as ExpenseCategory)}
                  className={select}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-rec`} className={label}>
                  {t("form.recurrence")}
                </label>
                <select
                  id={`${id}-rec`}
                  value={v.recurrence}
                  onChange={(e) => set("recurrence", e.target.value as ExpenseRecurrence)}
                  className={select}
                >
                  <option value="fixed">{t("recurrence.fixed")}</option>
                  <option value="recurring">{t("recurrence.recurring")}</option>
                  <option value="variable">{t("recurrence.variable")}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-supplier`} className={label}>
                  {t("form.supplier")}
                </label>
                <Input
                  id={`${id}-supplier`}
                  value={v.supplierName}
                  onChange={(e) => set("supplierName", e.target.value)}
                  placeholder={t("form.supplierPlaceholder")}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor={`${id}-status`} className={label}>
                  {t("form.status")}
                </label>
                <select
                  id={`${id}-status`}
                  value={v.status}
                  onChange={(e) => set("status", e.target.value as ExpenseStatus)}
                  className={select}
                >
                  <option value="pending">{t("status.pending")}</option>
                  <option value="paid">{t("status.paid")}</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor={`${id}-resp`} className={label}>
                {t("form.responsible")}
              </label>
              <Input
                id={`${id}-resp`}
                value={v.responsiblePerson}
                onChange={(e) => set("responsiblePerson", e.target.value)}
                placeholder={t("form.responsiblePlaceholder")}
                className={field}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? t("form.saving") : t("form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
