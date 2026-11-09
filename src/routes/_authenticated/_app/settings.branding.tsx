import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, History, Loader2, RotateCcw, Sparkles, Upload, X } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { OrgLogo } from "@/components/app/brand-mark";
import { PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  extractLogoColors,
  logoToDataUrl,
  validateLogo,
  type ExtractedColor,
} from "@/lib/brand-extractor";
import {
  contrastReport,
  FALLBACK_BRAND,
  generateTheme,
  themeToCssVars,
  type ThemeTokens,
} from "@/lib/theme-engine";
import { isHex } from "@/lib/color";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/settings/branding")({
  head: () => ({
    meta: [
      { title: "Branding & appearance · Servora" },
      {
        name: "description",
        content: "Upload a logo and generate an accessible workspace theme automatically.",
      },
      { property: "og:title", content: "Branding & appearance · Servora" },
      {
        property: "og:description",
        content: "Upload a logo and generate an accessible workspace theme automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandingPage,
});

function BrandingPage() {
  const { t } = useTranslation("settings");
  const { org, role, brand, saveBrand, resetBrand, restorePrevious, hasPrevious } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = useState<string | undefined>(brand.logoUrl);
  const [primary, setPrimary] = useState(brand.primary);
  const [accent, setAccent] = useState(brand.accent);
  const [candidates, setCandidates] = useState<ExtractedColor[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the editor when the organization or saved brand changes.
  useEffect(() => {
    setLogoUrl(brand.logoUrl);
    setPrimary(brand.primary);
    setAccent(brand.accent);
    setCandidates([]);
    setError(null);
  }, [brand]);

  const valid = isHex(primary) && isHex(accent);
  const draft = valid ? { primary, accent } : FALLBACK_BRAND;
  const light = useMemo(() => generateTheme(draft, "light"), [draft.primary, draft.accent]);
  const dark = useMemo(() => generateTheme(draft, "dark"), [draft.primary, draft.accent]);
  const report = useMemo(
    () => [
      ...contrastReport(light).map((r) => ({ ...r, mode: "light" })),
      ...contrastReport(dark).map((r) => ({ ...r, mode: "dark" })),
    ],
    [light, dark],
  );
  const dirty = primary !== brand.primary || accent !== brand.accent || logoUrl !== brand.logoUrl;

  async function analyze(src: string) {
    setAnalyzing(true);
    setError(null);
    try {
      const colors = await extractLogoColors(src);
      setCandidates(colors);
      if (colors.length === 0) {
        setError(t("errors.noColors"));
        return;
      }
      const first = colors[0];
      if (!first) return;
      setPrimary(first.hex);
      setAccent((colors[1] ?? first).hex);
      toast.success(t("toast.generated"));
    } catch {
      setError(t("errors.readFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function onFile(file?: File) {
    if (!file) return;
    const problem = validateLogo(file);
    if (problem) {
      setError(t(`errors.${problem}`));
      return;
    }
    try {
      const url = await logoToDataUrl(file);
      setLogoUrl(url);
      await analyze(url);
    } catch {
      setError(t("errors.readFailed"));
    }
  }

  async function persistBrand(action: () => Promise<void>, key: string) {
    setSaving(true);
    setError(null);
    try {
      await action();
      toast.success(t(`toast.${key}`));
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={<span className="eyebrow">{t("eyebrow")}</span>}
        title={t("branding.title")}
        description={t("branding.subtitle", { org: org.name })}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPrevious || role !== "owner" || saving}
              onClick={() => void persistBrand(restorePrevious, "restored")}
            >
              <History className="size-4" />
              {t("branding.restore")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={role !== "owner" || saving}
              onClick={() => void persistBrand(resetBrand, "reset")}
            >
              <RotateCcw className="size-4" />
              {t("branding.reset")}
            </Button>
            <Button
              size="sm"
              disabled={!valid || !dirty || analyzing || saving || role !== "owner"}
              onClick={() =>
                void persistBrand(() => saveBrand({ primary, accent, logoUrl }), "saved")
              }
            >
              <Check className="size-4" />
              {t("branding.apply")}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title={t("logo.title")} subtitle={t("logo.subtitle")}>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files[0]);
              }}
              className="flex flex-col items-center gap-4 rounded-lg border border-dashed bg-muted/40 p-6 text-center"
            >
              <OrgLogo
                logoUrl={logoUrl}
                initials={org.initials}
                className="size-24 rounded-xl text-2xl"
              />
              {role !== "owner" && (
                <p className="text-center text-xs text-muted-foreground">{t("logo.ownerOnly")}</p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={role !== "owner"}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" />
                  {logoUrl ? t("logo.replace") : t("logo.upload")}
                </Button>
                {logoUrl && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={analyzing}
                    onClick={() => analyze(logoUrl)}
                  >
                    {analyzing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {t("logo.analyze")}
                  </Button>
                )}
                {logoUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoUrl(undefined);
                      setCandidates([]);
                    }}
                    aria-label={t("logo.remove")}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("logo.formats")}</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {!logoUrl && <p className="mt-3 text-xs text-muted-foreground">{t("logo.fallback")}</p>}
          </Panel>

          <Panel
            title={t("palette.title")}
            subtitle={
              candidates.length
                ? t("palette.subtitleDetected", { count: candidates.length })
                : t("palette.subtitleEmpty")
            }
          >
            {candidates.length > 0 && (
              <div className="mb-5">
                <p className="eyebrow mb-2">{t("palette.detected")}</p>
                <div className="flex flex-wrap gap-2">
                  {candidates.map((c) => (
                    <div key={c.hex} className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => setPrimary(c.hex)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setAccent(c.hex);
                        }}
                        className={cn(
                          "size-10 rounded-lg border-2 shadow-xs transition-transform hover:scale-105",
                          primary === c.hex
                            ? "border-foreground"
                            : accent === c.hex
                              ? "border-muted-foreground"
                              : "border-transparent",
                        )}
                        style={{ background: c.hex }}
                        aria-label={t("palette.usePrimary", { hex: c.hex })}
                      />
                      <button
                        onClick={() => setAccent(c.hex)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        {t("palette.asAccent")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <ColorField
                id="primary"
                label={t("palette.primary")}
                value={primary}
                onChange={setPrimary}
                invalid={t("errors.hex")}
              />
              <ColorField
                id="accent"
                label={t("palette.accent")}
                value={accent}
                onChange={setAccent}
                invalid={t("errors.hex")}
              />
            </div>
            <TokenStrip tokens={light} />
          </Panel>

          <Panel title={t("contrast.title")} subtitle={t("contrast.subtitle")} bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-medium">{t("contrast.pair")}</th>
                  <th className="px-2 py-2 font-medium">{t("contrast.mode")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("contrast.ratio")}</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.mode + r.key} className="border-b last:border-0">
                    <td className="px-5 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-flex h-5 w-7 items-center justify-center rounded text-[10px] font-semibold"
                          style={{ background: r.bg, color: r.fg }}
                        >
                          Aa
                        </span>
                        {t(`contrast.pairs.${r.key}`)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {t(`contrast.${r.mode}`)}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <span
                        className={cn(
                          "tabular inline-flex items-center gap-1 text-xs font-medium",
                          r.pass ? "text-success" : "text-destructive",
                        )}
                      >
                        {r.ratio.toFixed(2)}:1{" "}
                        {r.pass ? <Check className="size-3" /> : <X className="size-3" />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title={t("preview.title")} subtitle={t("preview.subtitle")}>
            <div className="grid gap-4 2xl:grid-cols-2">
              <MiniWorkspace
                tokens={light}
                label={t("contrast.light")}
                name={org.name}
                logoUrl={logoUrl}
                initials={org.initials}
              />
              <MiniWorkspace
                tokens={dark}
                label={t("contrast.dark")}
                name={org.name}
                logoUrl={logoUrl}
                initials={org.initials}
              />
            </div>
          </Panel>
          <p className="text-xs text-muted-foreground">{t("engineNote")}</p>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: string;
}) {
  const ok = isHex(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <label
          className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs"
          style={{ background: ok ? value : undefined }}
        >
          <input
            type="color"
            value={ok ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={label}
          />
        </label>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs uppercase"
          aria-invalid={!ok}
          maxLength={7}
        />
      </div>
      {!ok && <p className="text-[11px] text-destructive">{invalid}</p>}
    </div>
  );
}

function TokenStrip({ tokens }: { tokens: ThemeTokens }) {
  const keys: (keyof ThemeTokens)[] = [
    "primary",
    "accent",
    "background",
    "foreground",
    "muted",
    "border",
    "chart1",
    "chart2",
    "chart3",
    "chart4",
    "chart5",
    "chart6",
    "sidebarBackground",
    "sidebarActive",
    "semanticSuccess",
    "semanticWarning",
    "semanticDanger",
  ];
  return (
    <div className="mt-5">
      <div className="flex h-8 overflow-hidden rounded-md border">
        {keys.map((k) => (
          <span
            key={k}
            title={`${k} ${tokens[k]}`}
            className="flex-1"
            style={{ background: tokens[k] }}
          />
        ))}
      </div>
    </div>
  );
}

function MiniWorkspace({
  tokens,
  label,
  name,
  logoUrl,
  initials,
}: {
  tokens: ThemeTokens;
  label: string;
  name: string;
  logoUrl?: string | undefined;
  initials: string;
}) {
  const { t } = useTranslation("settings");
  const style = themeToCssVars(tokens) as CSSProperties;
  const bars = [42, 58, 51, 66, 72, 61, 84];
  return (
    <div
      style={style}
      className="overflow-hidden rounded-xl border bg-background text-foreground shadow-card"
    >
      <div className="flex items-center justify-between border-b bg-card px-3 py-2 text-[11px]">
        <span className="font-medium">{label}</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
          {t("preview.chip")}
        </span>
      </div>
      <div className="flex min-h-[300px]">
        <aside className="hidden w-36 flex-col gap-1 border-r bg-sidebar p-2 text-[11px] text-sidebar-foreground sm:flex">
          <div className="mb-2 flex items-center gap-1.5 p-1">
            <OrgLogo logoUrl={logoUrl} initials={initials} className="size-6 rounded-md" />
            <span className="truncate font-semibold text-foreground">{name}</span>
          </div>
          {["overview", "locations", "branding"].map((k, i) => (
            <span
              key={k}
              className={cn(
                "rounded px-2 py-1.5",
                i === 0 && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              {t(`common:nav.${k}`)}
            </span>
          ))}
        </aside>
        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="grid grid-cols-3 gap-2">
            {["gross", "orders", "aov"].map((k, i) => (
              <div key={k} className="rounded-lg border bg-card p-2">
                <p className="text-[10px] text-muted-foreground">{t(`dashboard:kpi.${k}`)}</p>
                <p className="tabular text-sm font-semibold">{["$124K", "5,412", "$23.10"][i]}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-1 items-end gap-1.5 rounded-lg border bg-card p-3">
            {bars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  minHeight: 20,
                  background:
                    i === bars.length - 1
                      ? "var(--chart-1)"
                      : i % 2
                        ? "var(--chart-2)"
                        : "var(--chart-3)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground">
              {t("preview.primaryAction")}
            </span>
            <span className="inline-flex h-7 items-center rounded-md border bg-card px-3 text-[11px]">
              {t("preview.secondaryAction")}
            </span>
            <span className="ml-auto size-2 rounded-full bg-success" />
            <span className="size-2 rounded-full bg-warning" />
            <span className="size-2 rounded-full bg-destructive" />
          </div>
        </div>
      </div>
    </div>
  );
}
