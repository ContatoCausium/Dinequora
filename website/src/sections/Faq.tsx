import { Plus } from "lucide-react";
import { getFaqs } from "../content/copy";
import { Reveal, SectionHeader } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

export function Faq() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const faqs = getFaqs(locale);
  return (
    <section id="faq" aria-labelledby="faq-title" className="bg-offwhite py-24 text-ink sm:py-32">
      <div className="container-page grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:self-start">
          <SectionHeader
            id="faq-title"
            tone="light"
            eyebrow={t("FAQ", "Perguntas frequentes")}
            title={
              <>
                {t("Questions, ", "Perguntas, ")}
                <span className="accent-serif text-emerald-ink">{t("answered.", "respondidas.")}</span>
              </>
            }
            lead={t(
              "Implementation, subscriptions, billing, and locations. If you don't see your question here, ask us during your demo.",
              "Implantação, assinaturas, cobrança e unidades. Se a sua dúvida não estiver aqui, pergunte na demonstração.",
            )}
          />
        </div>
        <Reveal as="div" className="divide-y divide-line-light border-y border-line-light">
          {faqs.map((f) => (
            <details key={f.q} className="group py-1 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-lg py-5 text-left text-[1.05rem] font-semibold text-ink">
                {f.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-light text-slate transition-all duration-300 group-open:rotate-45 group-open:border-emerald group-open:bg-emerald group-open:text-navy">
                  <Plus aria-hidden className="size-4" />
                </span>
              </summary>
              <p className="max-w-2xl pb-6 text-[0.98rem] leading-relaxed text-slate">{f.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
