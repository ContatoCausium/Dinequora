import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FlaskConical, ImageUp, MapPin, RotateCcw } from "lucide-react";

import { DemoBadge, OrgLogo } from "@/components/app/brand-mark";
import { Section, Tag } from "@/components/control/control-ui";
import { ACCEPTED_LOGO_TYPES, extractLogoColors, validateLogo } from "@/lib/brand-extractor";
import { computeKpis } from "@/lib/demo-data";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { ORGANIZATIONS, PLANS, type Location } from "@/lib/tenants";
import {
  contrastReport,
  generateTheme,
  themeToCssVars,
  type BrandColors,
} from "@/lib/theme-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/control/demo")({
  head: () => ({
    meta: [
      { title: "Demo studio · Servora Control Center" },
      {
        name: "description",
        content:
          "Preview tenant branding, onboarding and location workflows with synthetic data only.",
      },
      { property: "og:title", content: "Demo studio · Servora Control Center" },
      {
        property: "og:description",
        content:
          "Preview tenant branding, onboarding and location workflows with synthetic data only.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemoStudio,
});

/**
 * Sandbox: everything here lives in browser memory only. It never writes to the
 * backend, never creates memberships and never reads customer tenant data.
 */
const SANDBOX_ID = "sandbox";
const fictional = (i: number): Location => ({
  id: `sbx-${i}`,
  name: `Sandbox Store ${i}`,
  status: "placeholder",
  timezone: "America/New_York",
  demoScale: 0.7 + i * 0.15,
});

function DemoStudio() {
  const { t, i18n } = useTranslation("control");
  const lng = i18n.language;
  const tenants = ORGANIZATIONS.filter((o) => o.fictional || o.id === "org_marao");
  const [tenantId, setTenantId] = useState<string>(SANDBOX_ID);
  const base = tenants.find((o) => o.id === tenantId);
  const [name, setName] = useState("Sandbox Bistro");
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth" | "enterprise">("growth");
  const [brand, setBrand] = useState<BrandColors>({ primary: "#3b6d5a", accent: "#d39b3a" });
  const [logo, setLogo] = useState<string | undefined>();
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [stores, setStores] = useState<Location[]>([fictional(1)]);
  const [step, setStep] = useState(0);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (base) {
      setName(base.name);
      setBrand(base.brand);
      setLogo(base.logoUrl);
      setStores(base.locations);
    } else {
      setName("Sandbox Bistro");
      setBrand({ primary: "#3b6d5a", accent: "#d39b3a" });
      setLogo(undefined);
      setStores([fictional(1)]);
    }
    setStep(0);
  }, [tenantId, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const theme = useMemo(() => generateTheme(brand, "light"), [brand]);
  const vars = useMemo(() => themeToCssVars(theme) as React.CSSProperties, [theme]);
  const contrast = useMemo(() => contrastReport(theme), [theme]);
  const kpis = useMemo(() => computeKpis(stores, 7), [stores]);
  const limit = PLANS[selectedPlan].maxLocations;

  const onLogo = async (file?: File) => {
    if (!file) return;
    const bad = validateLogo(file);
    if (bad) return setLogoErr(t(`demo.logoErr.${bad}`));
    setLogoErr(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setLogo(url);
    const colors = await extractLogoColors(url).catch(() => []);
    if (colors[0]) setBrand({ primary: colors[0].hex, accent: colors[1]?.hex ?? colors[0].hex });
  };

  return (
    <>
      <header className="mb-4">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.demo")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("demo.subtitle")}</p>
      </header>
      <div
        role="note"
        className="demo-stripe mb-6 flex items-start gap-3 rounded-lg border border-warning/40 px-4 py-3 text-sm"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
        <p>{t("demo.sandboxNote")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Section title={t("demo.controls")}>
          <div className="grid gap-4 p-5">
            <label className="grid gap-1.5 text-sm font-medium">
              {t("demo.tenant")}
              <select
                className="h-9 rounded-md border bg-card px-3 text-sm"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                <option value={SANDBOX_ID}>{t("demo.blank")}</option>
                {tenants.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {t("demo.demoTenant")}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("demo.name")}
              <input
                className="h-9 rounded-md border bg-card px-3 text-sm"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("demo.planSelector")}
              <select
                className="h-9 rounded-md border bg-card px-3 text-sm"
                value={selectedPlan}
                onChange={(e) =>
                  setSelectedPlan(e.target.value as "starter" | "growth" | "enterprise")
                }
              >
                <option value="starter">Starter ({PLANS.starter.maxLocations} lojas)</option>
                <option value="growth">Growth ({PLANS.growth.maxLocations} lojas)</option>
                <option value="enterprise">
                  Enterprise ({PLANS.enterprise.maxLocations} lojas)
                </option>
              </select>
            </label>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t("demo.logo")}</span>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-muted">
                <ImageUp className="size-4" />
                {t("demo.upload")}
                <input
                  type="file"
                  className="sr-only"
                  accept={ACCEPTED_LOGO_TYPES.join(",")}
                  onChange={(e) => void onLogo(e.target.files?.[0])}
                />
              </label>
              {logoErr && (
                <p role="alert" className="text-xs text-destructive">
                  {logoErr}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["primary", "accent"] as const).map((k) => (
                <label
                  key={k}
                  className="flex items-center justify-between gap-2 text-sm font-medium"
                >
                  {t(`demo.${k}`)}
                  <input
                    type="color"
                    value={brand[k]}
                    onChange={(e) => setBrand((b) => ({ ...b, [k]: e.target.value }))}
                    className="h-8 w-10 cursor-pointer rounded border bg-card p-0.5"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("demo.contrast", {
                pass: contrast.filter((c) => c.pass).length,
                total: contrast.length,
              })}
            </p>
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm font-medium hover:bg-muted"
            >
              <RotateCcw className="size-4" />
              {t("demo.reset")}
            </button>
          </div>
        </Section>

        {/* Scoped theme: the generated tokens apply only inside this preview. */}
        <div
          style={vars}
          className="grid gap-6 rounded-xl border bg-background p-4 text-foreground md:p-6"
        >
          <div className="flex flex-wrap items-center gap-3">
            <OrgLogo logoUrl={logo} initials={name.slice(0, 2).toUpperCase()} className="size-10" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold tracking-tight">{name || "—"}</p>
              <p className="text-xs text-muted-foreground">{t("demo.previewOf")}</p>
            </div>
            <DemoBadge label={t("demo.synthetic")} className="ml-auto" />
          </div>

          <dl className="surface grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-4">
            {[
              ["gross", fmtCurrency(kpis.gross, lng, true)],
              ["orders", fmtNumber(kpis.orders, lng)],
              ["aov", fmtCurrency(kpis.aov, lng)],
              ["open", fmtNumber(kpis.open, lng)],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{t(`demo.kpi.${k}`)}</dt>
                <dd className="tabular mt-1 text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="surface p-4">
              <p className="mb-3 text-sm font-semibold">{t("demo.onboarding")}</p>
              <ol className="grid gap-2">
                {(["workspace", "store", "branding", "team"] as const).map((k, i) => (
                  <li key={k}>
                    <button
                      onClick={() => setStep(i + 1)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm",
                        i < step ? "border-primary/40 bg-primary/5" : "hover:bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                          i < step
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i < step ? <Check className="size-3" /> : i + 1}
                      </span>
                      {t(`steps.${k}`)}
                    </button>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => setStep(0)}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                {t("demo.restart")}
              </button>
            </div>
            <div className="surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{t("demo.locations")}</p>
                <span className="tabular text-xs text-muted-foreground">
                  {t("demo.usage", { used: stores.length, limit })}
                </span>
              </div>
              <ul className="grid gap-2">
                {stores.map((l, idx) => (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <MapPin className="size-4 text-primary" />
                    <span className="flex-1 truncate">{l.name}</span>
                    <Tag tone={l.status === "verified" ? "neutral" : "warning"}>
                      {t(l.status === "verified" ? "demo.verified" : "demo.placeholderSlot")}
                    </Tag>
                    {stores.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setStores((prev) => prev.filter((_, i) => i !== idx))}
                        className="ml-2 text-xs text-muted-foreground hover:text-destructive"
                        title={t("demo.removeStore")}
                      >
                        &times;
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={stores.length >= limit}
                  onClick={() => setStores((s) => [...s, fictional(s.length + 1)])}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {t("demo.addStore")}
                </button>
                {stores.length >= limit && (
                  <p className="self-center text-xs text-muted-foreground">
                    {t("demo.limitReached")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
