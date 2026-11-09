import { getAiRoadmap } from "../content/copy";
import { Reveal, SectionHeader } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

export function AiRoadmap() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const aiRoadmap = getAiRoadmap(locale);
  return (
    <section aria-labelledby="ai-title" className="relative overflow-hidden bg-navy-950 py-24 sm:py-32">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 size-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(16_185_129/0.14),transparent_65%)]"
        aria-hidden
      />
      <div className="container-page relative">
        <div className="flex flex-col items-center text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald/30 bg-emerald/[0.06] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-emerald">
              <span aria-hidden className="size-1.5 rounded-full border border-emerald" />
              {t("On the roadmap · Not yet available", "No roadmap · Ainda não disponível")}
            </span>
          </Reveal>
          <div className="mt-6">
            <SectionHeader
              id="ai-title"
              align="center"
              eyebrow={t("Coming to Dinequora", "Em breve no Dinequora")}
              title={
                <>
                  {t("The next generation of ", "A próxima geração da ")}
                  <span className="accent-serif text-emerald">{t("restaurant intelligence.", "inteligência para restaurantes.")}</span>
                </>
              }
              lead={t(
                "Dinequora is being built with an AI roadmap. These capabilities are in development. They are not part of any current plan, and we'll announce availability before they launch.",
                "O Dinequora está sendo construído com um roadmap de IA. Estes recursos estão em desenvolvimento, não fazem parte de nenhum plano atual e vamos anunciar a disponibilidade antes do lançamento.",
              )}
            />
          </div>
        </div>

        <ul className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-line-dark bg-line-dark sm:grid-cols-2 lg:grid-cols-3">
          {aiRoadmap.map(({ title, body, icon: Icon }, i) => (
            <Reveal as="li" key={title} delay={(i % 3) * 90} className="group relative bg-navy-950/95 p-8 transition-colors duration-500 hover:bg-navy-900">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl border border-line-dark bg-white/[0.03] text-mist transition-colors duration-500 group-hover:border-emerald/40 group-hover:text-emerald">
                  <Icon aria-hidden className="size-5" strokeWidth={1.6} />
                </span>
                <span className="text-[0.68rem] font-semibold tracking-[0.14em] text-mist/60 uppercase">{t("In development", "Em desenvolvimento")}</span>
              </div>
              <h3 className="mt-7 text-lg font-semibold text-offwhite">{title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-mist">{body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
