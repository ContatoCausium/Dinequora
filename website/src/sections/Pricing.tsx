import { useState } from "react";
import { Check, Minus } from "lucide-react";
import {
  BILLING,
  BILLING_PERIODS,
  billingName,
  formatUsd,
  getComparison,
  getPlans,
  implementationPrice,
  periodPrice,
  type BillingPeriod,
  type ComparisonValue,
  type Plan,
} from "../config/pricing";
import { statusLabels } from "../content/features";
import { ButtonLink, cx, Reveal, SectionHeader } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

function RollingOutMark() {
  const { locale } = useLocale();
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-amber/10 px-1.5 py-px text-[0.65rem] font-semibold text-amber ring-1 ring-amber/25">
      {statusLabels[locale].rollingOut}
    </span>
  );
}

function PlanCard({ plan, index, period }: { plan: Plan; index: number; period: BillingPeriod }) {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const featured = Boolean(plan.highlight);
  return (
    <Reveal
      as="article"
      delay={index * 100}
      aria-labelledby={`plan-${plan.id}`}
      className={cx(
        // On desktop each card spans the shared 6-row subgrid, so name, summary, price,
        // implementation fee, button, and feature list line up across all three cards.
        "relative flex h-full flex-col rounded-3xl p-8 sm:p-9 lg:row-span-6 lg:grid lg:grid-cols-[minmax(0,1fr)] lg:grid-rows-subgrid lg:gap-y-0",
        featured
          ? "bg-[linear-gradient(180deg,#13233a,#0e1727)] shadow-[0_0_0_1px_rgb(16_185_129/0.55),0_40px_100px_-40px_rgb(16_185_129/0.45)]"
          : "surface-dark",
      )}
    >
      {featured && (
        <span className="absolute -top-3.5 left-8 rounded-full bg-emerald px-3 py-1 text-[0.7rem] font-bold tracking-[0.12em] text-navy uppercase">
          {plan.highlight}
        </span>
      )}
      <h3 id={`plan-${plan.id}`} className="text-xl font-semibold text-offwhite">
        {plan.name}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-mist">{plan.summary}</p>

      <div className="mt-7">
        {plan.monthly.kind === "fixed" ? (
          (() => {
            const price = periodPrice(plan.monthly.amountUsd, period);
            return (
              <>
                <p className="h-6 text-base text-mist tabular-nums">
                  {period !== "monthly" && (
                    <span className="line-through">
                      {formatUsd(plan.monthly.amountUsd, locale)} {t("/ month", "/ mês")}
                    </span>
                  )}
                </p>
                <p className="flex items-baseline gap-x-1.5 whitespace-nowrap">
                  <span className="display text-[2.6rem] text-offwhite tabular-nums">{formatUsd(price.perMonth, locale)}</span>
                  <span className="text-sm text-mist">{t("/ month", "/ mês")}</span>
                </p>
                <p className="mt-1 text-xs text-mist/80">
                  {period === "monthly"
                    ? t("Recurring subscription, billed monthly in USD", "Assinatura recorrente, cobrada todo mês em dólares (US$)")
                    : period === "semiannual"
                      ? t(
                          `${formatUsd(price.charge, locale)} billed every 6 months, upfront`,
                          `${formatUsd(price.charge, locale)} cobrados a cada 6 meses, à vista`,
                        )
                      : t(
                          `${formatUsd(price.charge, locale)} billed once a year, upfront`,
                          `${formatUsd(price.charge, locale)} cobrados uma vez por ano, à vista`,
                        )}
                </p>
                {price.savings > 0 && (
                  <p className="mt-2 inline-flex rounded-full bg-emerald/12 px-2.5 py-1 text-xs font-semibold text-emerald">
                    {t(`You save ${formatUsd(price.savings, locale)}`, `Você economiza ${formatUsd(price.savings, locale)}`)}
                  </p>
                )}
              </>
            );
          })()
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="display text-[2.4rem] leading-[1.2] whitespace-nowrap text-offwhite">{plan.monthly.label}</span>
            <span className="text-sm text-mist">{t("monthly pricing", "valor mensal")}</span>
          </p>
        )}
        {plan.monthly.kind !== "fixed" && (
          <p className="mt-1 text-xs text-mist/70">
            {t("Billing period agreed in your contract", "Forma de cobrança definida em contrato")}
          </p>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-line-dark bg-white/[0.025] px-4 py-3.5">
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-mist">{t("One-time implementation", "Implantação (pagamento único)")}</span>
          <span className="font-semibold text-offwhite tabular-nums">
            {implementationPrice(plan.implementation, locale)}
          </span>
        </p>
        <p className="mt-1 text-xs text-mist/70">
          {plan.implementation.kind === "startingAt" ? plan.implementation.note : t("Billed once", "Cobrada uma única vez")}
        </p>
      </div>

      <ButtonLink href={plan.cta.href} tone={featured ? "primary" : "ghost"} size="lg" arrow className="mt-7 w-full">
        {plan.cta.label}
      </ButtonLink>

      <ul className="mt-8 space-y-3 border-t border-line-dark pt-7 text-sm">
        {plan.features.map((f) => (
          <li key={f.label} className="flex gap-3 text-offwhite/90">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald" strokeWidth={2.5} />
            <span>
              {f.label}
              {f.rollingOut && <RollingOutMark />}
            </span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

function Cell({ value }: { value: ComparisonValue }) {
  const { locale } = useLocale();
  if (value === true)
    return (
      <>
        <Check aria-hidden className="mx-auto size-4 text-emerald" strokeWidth={2.5} />
        <span className="sr-only">{pick(locale, "Included", "Incluso")}</span>
      </>
    );
  if (value === false)
    return (
      <>
        <Minus aria-hidden className="mx-auto size-4 text-mist/30" />
        <span className="sr-only">{pick(locale, "Not included", "Não incluso")}</span>
      </>
    );
  return <span className="text-offwhite/90">{value}</span>;
}

/** Monthly / every 6 months / yearly. Longer periods are paid upfront and carry a discount. */
function PeriodSwitch({ value, onChange }: { value: BillingPeriod; onChange: (p: BillingPeriod) => void }) {
  const { locale } = useLocale();
  return (
    <div
      role="radiogroup"
      aria-label={pick(locale, "Billing period", "Forma de pagamento")}
      className="mx-auto mt-12 flex w-fit flex-wrap justify-center gap-1 rounded-full bg-navy-900 p-1.5 ring-1 ring-line-dark"
    >
      {BILLING_PERIODS.map((p) => {
        const on = p === value;
        const off = Math.round(BILLING[p].discount * 100);
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p)}
            className={cx(
              "flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-300 sm:px-5",
              on ? "bg-offwhite text-navy" : "text-mist hover:text-offwhite",
            )}
          >
            {billingName(p, locale)}
            {off > 0 && (
              <span className={cx("rounded-full px-1.5 py-0.5 text-[11px] font-bold", on ? "bg-emerald text-navy" : "bg-emerald/15 text-emerald")}>
                -{off}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pricing() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const plans = getPlans(locale);
  const comparison = getComparison(locale);
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="relative overflow-hidden bg-navy py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[500px] max-w-4xl rounded-full bg-emerald/[0.07] blur-[120px]" aria-hidden />
      <div className="container-page relative">
        <SectionHeader
          id="pricing-title"
          align="center"
          eyebrow={t("Pricing", "Preços")}
          title={
            <>
              {t("Clear pricing. ", "Preços claros. ")}
              <span className="accent-serif text-emerald">{t("No surprises.", "Sem surpresas.")}</span>
            </>
          }
          lead={t(
            "Every plan has two separate charges: a one-time implementation fee to set up your restaurant, and a subscription to use Dinequora, paid monthly, every 6 months or yearly.",
            "Todo plano tem duas cobranças separadas: uma taxa única de implantação para preparar seu restaurante e uma assinatura para usar o Dinequora, paga por mês, por semestre ou por ano.",
          )}
        />

        <Reveal className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line-dark bg-navy-900/70 px-5 py-4">
            <p className="text-xs font-semibold tracking-[0.14em] text-emerald uppercase">{t("1 · One-time", "1 · Pagamento único")}</p>
            <p className="mt-1.5 text-sm text-mist">
              <span className="font-medium text-offwhite">{t("Implementation fee.", "Taxa de implantação.")}</span>{" "}
              {t(
                "Discovery, configuration, team setup, training, and go-live. Paid once.",
                "Diagnóstico, configuração, equipe, treinamento e entrada em operação. Paga uma única vez.",
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-line-dark bg-navy-900/70 px-5 py-4">
            <p className="text-xs font-semibold tracking-[0.14em] text-emerald uppercase">{t("2 · Recurring", "2 · Recorrente")}</p>
            <p className="mt-1.5 text-sm text-mist">
              <span className="font-medium text-offwhite">{t("Subscription.", "Assinatura.")}</span>{" "}
              {t(
                "Access to Dinequora for the locations in your plan. Monthly, or save with 6 or 12 months upfront.",
                "Acesso ao Dinequora para as unidades do seu plano. Por mês, ou com desconto pagando 6 ou 12 meses à vista.",
              )}
            </p>
          </div>
        </Reveal>

        <PeriodSwitch value={period} onChange={setPeriod} />
        <p className="mt-3 text-center text-xs text-mist/75">
          {t(
            "Discount on the subscription only. Implementation is charged once, at the same price.",
            "O desconto vale para a assinatura. A implantação é cobrada uma única vez, pelo mesmo valor.",
          )}
        </p>

        <div className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-y-0">
          {plans.map((plan, i) => (
            <PlanCard key={plan.id} plan={plan} index={i} period={period} />
          ))}
        </div>

        <Reveal as="p" className="mx-auto mt-8 max-w-3xl text-center text-xs leading-relaxed text-mist/75">
          {t(
            "All prices in US dollars. Enterprise monthly pricing and implementation depend on the number of locations and the scope of the engagement, and are agreed in a written contract. Items marked ",
            "Todos os preços em dólares americanos (US$). No Enterprise, a mensalidade e a implantação dependem do número de unidades e do escopo do projeto, e são acordadas em contrato por escrito. Itens marcados como ",
          )}
          <RollingOutMark />
          {t(
            " are partially built today; we'll walk you through their current state during your demo.",
            " estão parcialmente prontos hoje; mostramos a situação atual de cada um na demonstração.",
          )}
        </Reveal>

        {/* Comparison table */}
        <Reveal className="mt-24">
          <h3 className="heading text-center text-2xl text-offwhite sm:text-3xl">{t("Compare plans", "Compare os planos")}</h3>
          <div className="mt-10 overflow-x-auto rounded-3xl border border-line-dark bg-navy-900/60">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">{t("Plan comparison", "Comparação de planos")}</caption>
              <thead>
                <tr className="border-b border-line-dark">
                  <th scope="col" className="w-[40%] px-6 py-5 text-left font-medium text-mist sm:px-8">
                    {t("Capability", "Recurso")}
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="px-4 py-5 text-center font-semibold text-offwhite">
                      {p.name}
                      {p.highlight && <span className="mt-1 block text-[0.65rem] font-semibold tracking-[0.12em] text-emerald uppercase">{p.highlight}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              {comparison.map((group) => (
                <tbody key={group.title}>
                  <tr>
                    <th scope="colgroup" colSpan={4} className="bg-white/[0.025] px-6 py-3 text-left text-[0.7rem] font-semibold tracking-[0.16em] text-mist uppercase sm:px-8">
                      {group.title}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-t border-line-dark/60">
                      <th scope="row" className="px-6 py-4 text-left font-normal text-offwhite/90 sm:px-8">
                        {row.label}
                        {row.rollingOut && <RollingOutMark />}
                      </th>
                      <td className="px-4 py-4 text-center">
                        <Cell value={row.values.starter} />
                      </td>
                      <td className="bg-emerald/[0.03] px-4 py-4 text-center">
                        <Cell value={row.values.growth} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <Cell value={row.values.enterprise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="mt-4 text-center text-xs text-mist/70">
            {t("* Enterprise location count is subject to contract.", "* O número de unidades no Enterprise é definido em contrato.")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
