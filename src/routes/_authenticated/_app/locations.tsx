import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BadgeCheck,
  Clock,
  Globe2,
  MapPin,
  Percent,
  Phone,
  Plus,
  Power,
  Settings2,
  UserRound,
} from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { DemoBadge } from "@/components/app/brand-mark";
import { usePresentationMode } from "@/components/app/use-presentation-mode";
import { PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { computeKpis } from "@/lib/demo-data";
import { storeMetricsSince, storeSalesMetrics } from "@/lib/location-metrics";
import { fetchAllOrders } from "@/lib/recorded-data";
import { fmtCurrency, fmtMoneyCents, fmtNumber, fmtPercent, fmtRatePpm } from "@/lib/format";
import { percentTextFromPpm, ppmFromPercentInput } from "@/lib/money";
import {
  createLocation,
  fetchTeam,
  saveLocationWithManagers,
  setLocationStatus,
  setLocationTaxRate,
  updateLocation,
} from "@/lib/org-service";
import {
  canAddStore,
  countBillableStores,
  DAYS,
  validateHours,
  type WeeklyHours,
} from "@/lib/access-rules";
import type { Location } from "@/lib/tenants";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/locations")({
  head: () => ({
    meta: [
      { title: "Locations · Dinequora" },
      {
        name: "description",
        content: "Manage restaurant locations, hours, time zones and store managers.",
      },
      { property: "og:title", content: "Locations · Dinequora" },
      {
        property: "og:description",
        content: "Manage restaurant locations, hours, time zones and store managers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocationsPage,
});

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Recife",
];

export function LocationsPage() {
  const { t, i18n } = useTranslation("locations");
  const lng = i18n.language;
  const { org, role, orgDbId, storeLimit, orgStatus, setLocationId, refresh, canAny } =
    useWorkspace();
  const navigate = useNavigate();
  const isOwner = role === "owner";
  // Every organization — demo-classified ones included — sees its own recorded sales (with a
  // financial permission). Synthetic figures appear only while presentation mode is explicitly on.
  const { active: showcase } = usePresentationMode();
  const canSeeSales = canAny(["dashboard.financials", "finance.view"]);
  const recorded = useQuery({
    queryKey: ["locations-sales", org.id],
    queryFn: () => fetchAllOrders(org.id, "all", storeMetricsSince()),
    enabled: !showcase && canSeeSales && org.locations.length > 0,
  });
  const billable = countBillableStores(org.locations.map((l) => l.lifecycle ?? "active"));
  const canAdd = canAddStore(role, billable, storeLimit, orgStatus === "suspended");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const team = useQuery({
    queryKey: ["team", orgDbId],
    queryFn: () => fetchTeam(orgDbId),
    enabled: isOwner,
  });
  const managers = (team.data?.members ?? []).filter((m) => m.role === "manager");

  const toggle = async (l: Location) => {
    if (!l.dbId) return;
    try {
      await setLocationStatus(l.dbId, l.lifecycle === "active" ? "inactive" : "active");
      toast.success(t(l.lifecycle === "active" ? "toast.deactivated" : "toast.activated"));
      refresh();
    } catch (e) {
      toast.error(t(`errors.${(e as Error).message}`, { defaultValue: t("errors.unknown") }));
    }
  };

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={
          <>
            <span className="eyebrow">{org.name}</span>
            {showcase && <DemoBadge label={t("common:demo.badge")} />}
          </>
        }
        title={t("title")}
        description={t("subtitle")}
        actions={
          isOwner ? (
            <Button
              disabled={!canAdd}
              title={!canAdd ? t("limitReached") : undefined}
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              {t("add")}
            </Button>
          ) : undefined
        }
      />

      <div className="surface mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-sm font-medium">
            {t("planUsage", { plan: t(`common:plans.${org.plan}`) })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {billable < storeLimit
              ? t("planRemaining", { count: storeLimit - billable })
              : t("limitReached")}{" "}
            {t("inactiveFree")}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:w-72">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={billable}
            aria-valuemax={storeLimit}
            aria-label={t("planUsageShort")}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(1, billable / Math.max(1, storeLimit)) * 100}%` }}
            />
          </div>
          <span className="tabular text-sm font-semibold">
            {billable}/{storeLimit}
          </span>
        </div>
      </div>

      {org.locations.length === 0 ? (
        <EmptyState
          icon={<MapPin className="size-5" strokeWidth={1.75} />}
          title={t(isOwner ? "empty.title" : "empty.unassignedTitle")}
          body={t(isOwner ? "empty.body" : "empty.unassignedBody")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {org.locations.map((l) => {
            const metrics = showcase
              ? (() => {
                  const k = computeKpis([l], 30);
                  return [
                    { k: "sales", v: fmtCurrency(k.gross, lng, true) },
                    { k: "orders", v: fmtNumber(k.orders, lng, true) },
                    { k: "growth", v: fmtPercent(k.growth, lng, true) },
                  ];
                })()
              : canSeeSales
                ? (() => {
                    if (!recorded.data) {
                      const v = recorded.isError ? t("metrics.unavailable") : "…";
                      return ["sales", "orders", "growth"].map((k) => ({ k, v }));
                    }
                    const m = storeSalesMetrics(recorded.data.orders, l.id);
                    return [
                      { k: "sales", v: fmtMoneyCents(m.salesCents, lng, { compact: true }) },
                      { k: "orders", v: fmtNumber(m.orders, lng, true) },
                      {
                        k: "growth",
                        v: m.growth === null ? "—" : fmtPercent(m.growth, lng, true),
                      },
                    ];
                  })()
                : null;
            const lc = l.lifecycle ?? "active";
            const assigned = managers.filter((m) => l.dbId && m.location_ids.includes(l.dbId));
            const openDays = DAYS.filter((d) => l.hours?.[d]).length;
            return (
              <article
                key={l.id}
                className={cn("surface flex flex-col", lc === "inactive" && "opacity-70")}
              >
                <div className="flex items-start justify-between gap-3 p-5 pb-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">{l.name}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">{l.address ?? t("addressMissing")}</span>
                    </p>
                  </div>
                  <StatusChip lifecycle={lc} verified={l.status === "verified"} />
                </div>

                {metrics && (
                  <dl className="grid grid-cols-3 gap-px border-y bg-border">
                    {metrics.map((m) => (
                      <div key={m.k} className="bg-card px-5 py-3">
                        <dt className="text-[11px] text-muted-foreground">{t(`metrics.${m.k}`)}</dt>
                        <dd className="tabular mt-0.5 text-sm font-semibold">{m.v}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <ul className="flex flex-col gap-2 p-5 text-sm">
                  <Info icon={Globe2} label={t("timezone")} value={l.timezone.replace(/_/g, " ")} />
                  <Info
                    icon={Clock}
                    label={t("hours")}
                    value={openDays ? t("openDays", { count: openDays }) : t("notConfigured")}
                  />
                  <Info
                    icon={Percent}
                    label={t("taxRate")}
                    value={
                      l.taxRatePpm == null ? t("taxNotConfigured") : fmtRatePpm(l.taxRatePpm, lng)
                    }
                  />
                  {l.phone && <Info icon={Phone} label={t("phone")} value={l.phone} />}
                  {isOwner && (
                    <Info
                      icon={UserRound}
                      label={t("manager")}
                      value={
                        assigned.length
                          ? assigned.map((m) => m.full_name ?? t("team:page.unnamed")).join(", ")
                          : t("unassigned")
                      }
                    />
                  )}
                </ul>

                <div className="mt-auto flex flex-wrap gap-2 border-t p-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1"
                    disabled={lc === "inactive"}
                    onClick={() => {
                      setLocationId(l.id);
                      void navigate({ to: "/" });
                    }}
                  >
                    {t("openDashboard")}
                  </Button>
                  {role !== "staff" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-10"
                      onClick={() => setEditing(l)}
                    >
                      {lc === "placeholder" ? t("completeSetup") : t("edit")}
                    </Button>
                  )}
                  {isOwner && lc !== "placeholder" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10"
                      onClick={() => void toggle(l)}
                      aria-label={lc === "active" ? t("deactivate") : t("activate")}
                      title={lc === "active" ? t("deactivate") : t("activate")}
                    >
                      <Power className="size-4" strokeWidth={1.75} />
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        {t(showcase ? "placeholderNote" : canSeeSales ? "recordedNote" : "setupNote")}
        {!showcase && recorded.data?.truncated ? ` ${t("metrics.truncated")}` : ""}
      </p>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {editing && (
        <EditSheet
          location={editing}
          managers={managers}
          isOwner={isOwner}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-muted-foreground">
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      {label}:<span className="truncate text-foreground">{value}</span>
    </li>
  );
}

function StatusChip({ lifecycle, verified }: { lifecycle: string; verified: boolean }) {
  const { t } = useTranslation("locations");
  const kind =
    lifecycle === "inactive"
      ? "inactive"
      : lifecycle === "placeholder"
        ? "placeholder"
        : verified
          ? "verified"
          : "active";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        kind === "verified" && "bg-success/12 text-success",
        kind === "active" && "bg-primary-soft text-primary",
        kind === "placeholder" && "bg-warning/15 text-foreground",
        kind === "inactive" && "bg-muted text-muted-foreground",
      )}
    >
      {kind === "verified" ? (
        <BadgeCheck className="size-3" />
      ) : kind === "placeholder" ? (
        <Settings2 className="size-3" />
      ) : (
        <Power className="size-3" />
      )}
      {t(`status.${kind}`)}
    </span>
  );
}

function TzSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = TIMEZONES.includes(value) ? TIMEZONES : [value, ...TIMEZONES];
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {opts.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("locations");
  const { orgDbId, refresh } = useWorkspace();
  const [v, setV] = useState({ name: "", address: "", phone: "", timezone: "America/New_York" });
  const [taxRate, setTaxRate] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (v.name.trim().length < 2) {
      toast.error(t("errors.invalid_name"));
      return;
    }
    // The sales-tax rate is required: without it the store cannot record a sale (0025).
    const taxRatePpm = ppmFromPercentInput(taxRate);
    if (taxRatePpm === null) {
      toast.error(t("errors.invalid_tax_rate"));
      return;
    }
    setBusy(true);
    try {
      // One server transaction: the store and its rate exist together, or nothing was written.
      await createLocation(orgDbId, { ...v, taxRatePpm });
      toast.success(t("toast.created"));
      refresh();
      onClose();
    } catch (err) {
      toast.error(t(`errors.${(err as Error).message}`, { defaultValue: t("errors.unknown") }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.body")}</DialogDescription>
          </DialogHeader>
          <Labeled id="c-name" label={t("form.name")}>
            <Input
              id="c-name"
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              maxLength={80}
            />
          </Labeled>
          <Labeled id="c-addr" label={t("form.address")}>
            <Input
              id="c-addr"
              value={v.address}
              onChange={(e) => setV({ ...v, address: e.target.value })}
            />
          </Labeled>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled id="c-phone" label={t("form.phone")}>
              <Input
                id="c-phone"
                type="tel"
                value={v.phone}
                onChange={(e) => setV({ ...v, phone: e.target.value })}
              />
            </Labeled>
            <Labeled id="c-tz" label={t("timezone")}>
              <TzSelect
                id="c-tz"
                value={v.timezone}
                onChange={(z) => setV({ ...v, timezone: z })}
              />
            </Labeled>
          </div>
          <Labeled id="c-tax" label={t("form.taxRate")}>
            <Input
              id="c-tax"
              inputMode="decimal"
              placeholder="8.875"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              aria-describedby="c-tax-hint"
            />
            <p id="c-tax-hint" className="text-xs text-muted-foreground">
              {t("form.taxRateHint")}
            </p>
          </Labeled>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Labeled({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

type Mgr = { id: string; full_name: string | null; location_ids: string[] };

function EditSheet({
  location,
  managers,
  isOwner,
  onClose,
}: {
  location: Location;
  managers: Mgr[];
  isOwner: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("locations");
  const { orgDbId, refresh } = useWorkspace();
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: location.name,
    address: location.address ?? "",
    phone: location.phone ?? "",
    timezone: location.timezone,
  });
  const [taxRate, setTaxRate] = useState(
    location.taxRatePpm == null ? "" : percentTextFromPpm(location.taxRatePpm),
  );
  const [hours, setHours] = useState<WeeklyHours>(location.hours ?? {});
  const [mgrs, setMgrs] = useState<string[]>(
    managers
      .filter((m) => location.dbId && m.location_ids.includes(location.dbId))
      .map((m) => m.id),
  );
  const [busy, setBusy] = useState(false);
  const bad = validateHours(hours);
  const reason = (err: unknown) =>
    t(`errors.${(err as Error).message}`, { defaultValue: t("errors.unknown") });
  // Parsed exactly from the text (8.875 -> 88,750 ppm); null = not a valid rate.
  const taxRatePpm = ppmFromPercentInput(taxRate);
  const saveTaxRate = async () => {
    if (!location.dbId || taxRatePpm === null || taxRatePpm === (location.taxRatePpm ?? null))
      return;
    await setLocationTaxRate(location.dbId, taxRatePpm);
  };

  const save = async () => {
    if (!location.dbId) return;
    if (bad.length) {
      toast.error(t("errors.invalid_hours"));
      return;
    }
    if (taxRatePpm === null) {
      toast.error(t("errors.invalid_tax_rate"));
      return;
    }
    setBusy(true);
    try {
      await saveLocationWithManagers(location.dbId, { ...v, hours }, isOwner ? mgrs : null);
    } catch (err) {
      toast.error(reason(err));
      setBusy(false);
      return;
    }
    try {
      await saveTaxRate();
      toast.success(t("toast.saved"));
      void qc.invalidateQueries({ queryKey: ["team", orgDbId] });
      refresh();
      onClose();
    } catch (err) {
      // The details are already saved; only the rate was refused. Say exactly that and show the
      // saved state instead of leaving the owner unsure of what was written.
      toast.error(t("errors.tax_rate_not_saved", { reason: reason(err) }));
      void qc.invalidateQueries({ queryKey: ["team", orgDbId] });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!location.dbId) return;
    if (bad.length) {
      toast.error(t("errors.invalid_hours"));
      return;
    }
    if (!v.address.trim()) {
      toast.error(t("errors.address_required"));
      return;
    }
    if (taxRatePpm === null) {
      toast.error(t("errors.invalid_tax_rate"));
      return;
    }
    setBusy(true);
    try {
      await updateLocation(location.dbId, { ...v, hours });
    } catch (err) {
      toast.error(reason(err));
      setBusy(false);
      return;
    }
    try {
      await saveTaxRate();
    } catch (err) {
      toast.error(t("errors.tax_rate_not_saved", { reason: reason(err) }));
      refresh();
      setBusy(false);
      return;
    }
    try {
      await setLocationStatus(location.dbId, "active");
      toast.success(t("toast.activated"));
      refresh();
      onClose();
    } catch (err) {
      // Details and rate are saved; only the activation was refused (for example the plan allowance).
      toast.error(t("errors.not_activated", { reason: reason(err) }));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-5">
          <SheetTitle>{t("editTitle")}</SheetTitle>
          <SheetDescription>{location.name}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-5">
          <section className="flex flex-col gap-4">
            <p className="eyebrow">{t("form.details")}</p>
            <Labeled id="e-name" label={t("form.name")}>
              <Input
                id="e-name"
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                maxLength={80}
              />
            </Labeled>
            <Labeled id="e-addr" label={t("form.address")}>
              <Input
                id="e-addr"
                value={v.address}
                onChange={(e) => setV({ ...v, address: e.target.value })}
              />
            </Labeled>
            {location.status === "verified" && (
              <p className="-mt-2 text-xs text-muted-foreground">{t("form.verifiedNote")}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled id="e-phone" label={t("form.phone")}>
                <Input
                  id="e-phone"
                  type="tel"
                  value={v.phone}
                  onChange={(e) => setV({ ...v, phone: e.target.value })}
                />
              </Labeled>
              <Labeled id="e-tz" label={t("timezone")}>
                <TzSelect
                  id="e-tz"
                  value={v.timezone}
                  onChange={(z) => setV({ ...v, timezone: z })}
                />
              </Labeled>
            </div>
            <Labeled id="e-tax" label={t("form.taxRate")}>
              <Input
                id="e-tax"
                inputMode="decimal"
                placeholder="8.875"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                aria-invalid={taxRatePpm === null}
                aria-describedby="e-tax-hint"
              />
              <p id="e-tax-hint" className="text-xs text-muted-foreground">
                {t("form.taxRateHint")}
              </p>
            </Labeled>
          </section>

          <section className="flex flex-col gap-2">
            <p className="eyebrow">{t("hours")}</p>
            {DAYS.map((d) => {
              const h = hours[d];
              return (
                <div
                  key={d}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-1",
                    bad.includes(d) && "bg-destructive/10",
                  )}
                >
                  <Switch
                    id={`h-${d}`}
                    checked={!!h}
                    aria-label={t(`days.${d}`)}
                    onCheckedChange={(on) =>
                      setHours({ ...hours, [d]: on ? { open: "11:00", close: "22:00" } : null })
                    }
                  />
                  <label htmlFor={`h-${d}`} className="w-12 text-sm font-medium">
                    {t(`days.${d}`)}
                  </label>
                  {h ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        type="time"
                        aria-label={t("form.opens")}
                        className="h-9"
                        value={h.open}
                        onChange={(e) =>
                          setHours({ ...hours, [d]: { ...h, open: e.target.value } })
                        }
                      />
                      <span className="text-muted-foreground">–</span>
                      <Input
                        type="time"
                        aria-label={t("form.closes")}
                        className="h-9"
                        value={h.close}
                        onChange={(e) =>
                          setHours({ ...hours, [d]: { ...h, close: e.target.value } })
                        }
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("closed")}</span>
                  )}
                </div>
              );
            })}
          </section>

          {isOwner && (
            <section className="flex flex-col gap-2">
              <p className="eyebrow">{t("managers")}</p>
              {managers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noManagers")}</p>
              ) : (
                managers.map((m) => (
                  <label
                    key={m.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={mgrs.includes(m.id)}
                      onChange={(e) =>
                        setMgrs(e.target.checked ? [...mgrs, m.id] : mgrs.filter((x) => x !== m.id))
                      }
                    />
                    <span className="text-sm">{m.full_name ?? t("team:page.unnamed")}</span>
                  </label>
                ))
              )}
            </section>
          )}
        </div>
        <SheetFooter className="mt-auto flex-row gap-2 border-t p-4">
          {isOwner && location.lifecycle === "placeholder" && (
            <Button variant="secondary" disabled={busy} onClick={() => void activate()}>
              {t("activate")}
            </Button>
          )}
          <Button className="flex-1" disabled={busy} onClick={() => void save()}>
            {t("form.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
