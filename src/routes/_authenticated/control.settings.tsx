import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Eye,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { LoadingRows, Section, Tag } from "@/components/control/control-ui";
import { listPlans, pingBackend, type PlanDef } from "@/lib/admin-service";
import { fmtCurrency } from "@/lib/format";
import { LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LoadFailure } from "@/components/control/load-failure";
import { requestErrorKind, type RequestErrorKind } from "@/lib/request-error";

export const Route = createFileRoute("/_authenticated/control/settings")({
  head: () => ({
    meta: [
      { title: "Platform settings · Dinequora Control Center" },
      {
        name: "description",
        content: "Platform identity, plan definitions, integration status and security controls.",
      },
      { property: "og:title", content: "Platform settings · Dinequora Control Center" },
      {
        property: "og:description",
        content: "Platform identity, plan definitions, integration status and security controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

type State = "ok" | "off" | "pending" | "unverified" | "failed";
const SECURITY = [
  "confirm",
  "noAutoAdmin",
  "isolation",
  "storeScope",
  "auditImmutable",
  "reasons",
  "lastOwner",
  "suspension",
] as const;

function Settings() {
  const { t, i18n } = useTranslation("control");
  const [plans, setPlans] = useState<PlanDef[] | null>(null);
  const [ping, setPing] = useState<{ ok: boolean; ms: number } | null>(null);
  const [planError, setPlanError] = useState<RequestErrorKind | null>(null);
  const [pingError, setPingError] = useState<RequestErrorKind | null>(null);
  const loadPlans = useCallback(async () => {
    setPlans(null);
    setPlanError(null);
    try {
      setPlans(await listPlans());
    } catch (e) {
      setPlanError(requestErrorKind(e));
    }
  }, []);
  const loadPing = useCallback(async () => {
    setPing(null);
    setPingError(null);
    try {
      setPing(await pingBackend());
    } catch (e) {
      setPingError(requestErrorKind(e));
    }
  }, []);
  useEffect(() => {
    void loadPlans();
    void loadPing();
  }, [loadPlans, loadPing]);

  const integrations: { key: string; state: State; detail?: string }[] = [
    {
      key: "backend",
      state: pingError ? "failed" : ping ? (ping.ok ? "ok" : "failed") : "pending",
      ...(ping ? { detail: t("settings.latency", { ms: ping.ms }) } : {}),
    },
    {
      key: "authEmail",
      state: "ok",
      detail: t("settings.int.authEmailDetail", {
        defaultValue: "Supabase Auth operacional via supabase.auth",
      }),
    },
    { key: "google", state: "unverified" },
    { key: "microsoft", state: "unverified" },
    { key: "stripe", state: "off" },
    { key: "email", state: "unverified" },
  ];

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.settings")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </header>
      <div className="grid gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={t("settings.identity")} hint={t("settings.identityHint")}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 text-sm sm:grid-cols-2">
              <Row
                label={t("settings.productName")}
                value={
                  <>
                    Dinequora <Tag>{t("settings.workingName")}</Tag>
                  </>
                }
              />
              <Row label={t("settings.currency")} value="USD" />
              <Row label={t("settings.defaultLanguage")} value="English (US)" />
              <Row
                label={t("settings.languages")}
                value={LANGUAGES.map((l) => l.label).join(" · ")}
              />
            </dl>
          </Section>
          <Section title={t("settings.integrations")} hint={t("settings.integrationsHint")}>
            <ul className="divide-y">
              {integrations.map((x) => (
                <li key={x.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                  {x.state === "ok" ? (
                    <CheckCircle2 className="mt-0.5 size-4 text-success" />
                  ) : x.state === "pending" ? (
                    <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" />
                  ) : x.state === "failed" ? (
                    <AlertTriangle className="mt-0.5 size-4 text-destructive" />
                  ) : (
                    <CircleSlash className="mt-0.5 size-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t(`settings.int.${x.key}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {x.detail ?? t(`settings.int.${x.key}Detail`)}
                    </p>
                  </div>
                  <Tag
                    tone={
                      x.state === "ok" ? "neutral" : x.state === "failed" ? "danger" : "warning"
                    }
                  >
                    {t(`settings.state.${x.state}`)}
                  </Tag>
                </li>
              ))}
            </ul>
            {pingError && (
              <div className="px-5">
                <LoadFailure kind={pingError} retry={() => void loadPing()} />
              </div>
            )}
          </Section>
        </div>

        <Section title={t("settings.plans")} hint={t("settings.plansHint")}>
          {planError ? (
            <div className="px-5">
              <LoadFailure kind={planError} retry={() => void loadPlans()} />
            </div>
          ) : !plans ? (
            <div className="p-4">
              <LoadingRows rows={3} />
            </div>
          ) : plans.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{t("settings.noPlans")}</p>
          ) : (
            <div className="min-w-0 max-w-full overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  <tr>
                    {["plan", "price", "stores", "trialStores", "trialDays"].map((h) => (
                      <th key={h} className="px-5 py-2.5 font-medium">
                        {t(`settings.col.${h}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-2.5 font-medium">
                        {t(`plans.${p.id}`, { defaultValue: p.name })}
                      </td>
                      <td className="tabular px-5 py-2.5">
                        {fmtCurrency(p.price_per_location_cents / 100, i18n.language)}
                        {p.is_placeholder_pricing && (
                          <span className="ml-2">
                            <Tag tone="warning">{t("settings.placeholder")}</Tag>
                          </span>
                        )}
                      </td>
                      <td className="tabular px-5 py-2.5">{p.default_store_limit}</td>
                      <td className="tabular px-5 py-2.5">{p.trial_store_limit}</td>
                      <td className="tabular px-5 py-2.5">{p.trial_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={t("settings.monitoringTitle")} hint={t("settings.monitoringHint")}>
            <div className="grid gap-3 p-5 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2.5">
                  <Activity className="size-4 text-success" />
                  <div>
                    <p className="font-medium">API & Banco de Dados (Ping)</p>
                    <p className="text-xs text-muted-foreground">
                      {ping ? `${ping.ms} ms de resposta média` : "Carregando..."}
                    </p>
                  </div>
                </div>
                <Tag tone="neutral">{t("settings.metricClassification.real")}</Tag>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2.5">
                  <Eye className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Projeção de Faturamento e MRR</p>
                    <p className="text-xs text-muted-foreground">
                      Preços de catálogo com Stripe desconectado
                    </p>
                  </div>
                </div>
                <Tag tone="warning">{t("settings.metricClassification.simulated")}</Tag>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2.5">
                  <Eye className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Métricas de Vendas dos Restaurantes</p>
                    <p className="text-xs text-muted-foreground">
                      Alimentadas por modelos estatísticos de demonstração
                    </p>
                  </div>
                </div>
                <Tag tone="warning">{t("settings.metricClassification.simulated")}</Tag>
              </div>
            </div>
          </Section>

          <Section title={t("settings.authAuditTitle")} hint={t("settings.authAuditHint")}>
            <div className="grid gap-3.5 p-5 text-sm">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="font-medium">{t("settings.authAudit.status")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.authAudit.statusOk")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="font-medium">Row Level Security (RLS)</p>
                  <p className="text-xs text-muted-foreground">{t("settings.authAudit.rls")}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="font-medium">Sessões e Tokens</p>
                  <p className="text-xs text-muted-foreground">{t("settings.authAudit.tokens")}</p>
                </div>
              </div>
            </div>
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Section title={t("settings.security")} hint={t("settings.securityHint")}>
            <ul className="grid gap-2.5 p-5">
              {SECURITY.map((k) => (
                <li key={k} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {t(`settings.sec.${k}`)}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t("settings.governance")}>
            <div className="grid gap-2 p-5 text-sm">
              <Link
                to="/control/admins"
                className="rounded-md border px-3 py-2.5 font-medium hover:bg-muted"
              >
                {t("nav.admins")}
                <p className="text-xs font-normal text-muted-foreground">
                  {t("settings.adminsLink")}
                </p>
              </Link>
              <Link
                to="/control/audit"
                className="rounded-md border px-3 py-2.5 font-medium hover:bg-muted"
              >
                {t("nav.audit")}
                <p className="text-xs font-normal text-muted-foreground">
                  {t("settings.auditLink")}
                </p>
              </Link>
              <p className="flex items-start gap-2 pt-2 text-xs text-muted-foreground">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0" />
                {t("settings.authorizationNote")}
              </p>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 break-words font-medium">
        {value}
      </dd>
    </div>
  );
}
