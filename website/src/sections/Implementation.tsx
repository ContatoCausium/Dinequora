import { getImplementationIncludes, getImplementationSteps } from "../content/copy";
import { getPlans, implementationPrice } from "../config/pricing";
import { Reveal, SectionHeader } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

export function Implementation() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const plans = getPlans(locale);
  const implementationSteps = getImplementationSteps(locale);
  const implementationIncludes = getImplementationIncludes(locale);
  return (
    <section id="implementation" aria-labelledby="implementation-title" className="relative bg-offwhite py-24 text-ink sm:py-32">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-end">
          <SectionHeader
            id="implementation-title"
            tone="light"
            eyebrow={t("Implementation", "Implantação")}
            title={
              <>
                {t("Your restaurant. Fully set up and ", "Seu restaurante. Totalmente configurado e ")}
                <span className="accent-serif text-emerald-ink">{t("ready to run.", "pronto para operar.")}</span>
              </>
            }
          />
          <Reveal as="p" delay={80} className="max-w-xl text-base leading-relaxed text-slate sm:text-lg lg:justify-self-end">
            {t(
              "Every plan starts with a guided implementation. Our team configures Dinequora with you and trains your people remotely, so you open on day one with your menu, inventory, and team already in place.",
              "Todo plano começa com uma implantação guiada. Nossa equipe configura o Dinequora com você e treina seu pessoal remotamente, para você abrir no primeiro dia com cardápio, estoque e equipe já prontos.",
            )}
          </Reveal>
        </div>

        <ol className="relative mt-16 grid gap-4 md:grid-cols-5 md:gap-0 md:before:absolute md:before:top-[27px] md:before:right-[10%] md:before:left-[10%] md:before:h-px md:before:bg-line-light">
          {implementationSteps.map((step, i) => (
            <Reveal as="li" key={step.number} delay={i * 90} className="relative md:px-4 md:first:pl-0 md:last:pr-0">
              <div className="flex items-start gap-5 rounded-2xl border border-line-light bg-white p-6 md:flex-col md:border-0 md:bg-transparent md:p-0">
                <span className="relative z-10 grid size-14 shrink-0 place-items-center rounded-2xl bg-navy text-[0.95rem] font-semibold text-emerald tabular-nums shadow-[0_10px_30px_-12px_rgb(11_19_32/0.6)]">
                  {step.number}
                </span>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight text-ink">{step.title}</h3>
                  <p className="mt-2 text-[0.94rem] leading-relaxed text-slate">{step.body}</p>
                  <ul className="mt-4 space-y-1.5">
                    {step.deliverables.map((d) => (
                      <li key={d} className="flex items-center gap-2 text-[0.85rem] font-medium text-ink/80">
                        <span aria-hidden className="size-1.5 rounded-full bg-emerald" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mt-20 overflow-hidden rounded-3xl border border-line-light bg-white shadow-[0_30px_80px_-50px_rgb(11_19_32/0.5)]">
          <div className="flex flex-col gap-2 border-b border-line-light p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-ink">{t("What implementation includes", "O que a implantação inclui")}</h3>
              <p className="mt-1 text-sm text-slate">
                {t("Billed once, separately from your monthly subscription.", "Cobrada uma única vez, separada da assinatura mensal.")}
              </p>
            </div>
            <p className="text-sm text-slate">
              {t(
                "Delivered remotely. On-site installation and hardware are not included.",
                "Feita de forma remota. Não inclui instalação presencial nem equipamentos.",
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">{t("Implementation services by plan", "Serviços de implantação por plano")}</caption>
              <thead>
                <tr className="text-ink">
                  <th scope="col" className="w-[34%] px-6 py-5 font-medium text-slate sm:px-8">{t("Service", "Serviço")}</th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="px-4 py-5 font-semibold">
                      {p.name}
                      <span className="mt-0.5 block text-xs font-medium text-slate">{implementationPrice(p.implementation, locale)} {t("one-time", "(pagamento único)")}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {implementationIncludes.map((row) => (
                  <tr key={row.label} className="border-t border-line-light">
                    <th scope="row" className="px-6 py-4 font-medium text-ink sm:px-8">{row.label}</th>
                    <td className="px-4 py-4 text-slate">{row.starter}</td>
                    <td className="px-4 py-4 text-slate">{row.growth}</td>
                    <td className="px-4 py-4 text-slate">{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
