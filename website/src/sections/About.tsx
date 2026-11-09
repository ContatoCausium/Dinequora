import { Eye, Lock, Scale } from "lucide-react";
import { Reveal, SectionHeader } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

const principles = {
  en: [
    {
      icon: Scale,
      title: "Honest numbers",
      body: "Sample data is always labeled. Capabilities are described as they exist today. Prices are published, implementation fee included.",
    },
    {
      icon: Lock,
      title: "Secure by design",
      body: "Every restaurant's data is isolated from every other, access is scoped by role and location, and sensitive changes are logged.",
    },
    {
      icon: Eye,
      title: "Built with operators",
      body: "Screens are shaped around real service: the register at the rush, the line at the pass, the office at close.",
    },
  ],
  pt: [
    {
      icon: Scale,
      title: "Números honestos",
      body: "Dados de exemplo sempre identificados. Recursos descritos como existem hoje. Preços publicados, incluindo a taxa de implantação.",
    },
    {
      icon: Lock,
      title: "Seguro desde a concepção",
      body: "Os dados de cada restaurante ficam isolados dos demais, o acesso é limitado por função e unidade, e alterações sensíveis ficam registradas.",
    },
    {
      icon: Eye,
      title: "Feito com quem opera",
      body: "Telas pensadas para o serviço real: o caixa na hora do pico, a cozinha no passe, o escritório no fechamento.",
    },
  ],
};

export function About() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return (
    <section id="about" aria-labelledby="about-title" className="relative bg-navy py-24 sm:py-32">
      <div className="container-page grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative order-last lg:order-first">
          <div className="relative overflow-hidden rounded-3xl">
            <img
              src="/images/dish-black.webp"
              alt={t("Carefully plated dish served on a white plate", "Prato cuidadosamente montado servido em um prato branco")}
              width={1200}
              height={777}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy/70 via-transparent to-transparent" aria-hidden />
          </div>
          <div className="absolute -right-4 -bottom-6 hidden rounded-2xl border border-line-dark bg-navy-900/95 p-5 backdrop-blur sm:block lg:-right-8">
            <img src="/brand/dinequora_icone_transparente.svg" alt="" width={36} height={36} className="size-9" />
            <p className="mt-3 text-[0.68rem] font-semibold tracking-[0.18em] text-mist uppercase">
              {t("Restaurant Intelligence Platform", "Plataforma de inteligência para restaurantes")}
            </p>
          </div>
        </Reveal>

        <div>
          <SectionHeader
            id="about-title"
            eyebrow={t("About Dinequora", "Sobre o Dinequora")}
            title={
              <>
                {t("Technology that respects ", "Tecnologia que respeita ")}
                <span className="accent-serif text-emerald">{t("the craft.", "o ofício.")}</span>
              </>
            }
            lead={t(
              "Dinequora is a restaurant management platform built for the United States market. We started with a simple belief: the people who run restaurants deserve software as precise as their kitchens, with clear information, fair pricing, and no surprises.",
              "O Dinequora é uma plataforma de gestão de restaurantes criada para o mercado dos Estados Unidos. Começamos com uma ideia simples: quem toca um restaurante merece um sistema tão preciso quanto a sua cozinha, com informação clara, preço justo e sem surpresas.",
            )}
          />
          <ul className="mt-10 space-y-7">
            {principles[locale].map(({ icon: Icon, title, body }, i) => (
              <Reveal as="li" key={title} delay={i * 90} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-dark bg-white/[0.03] text-emerald">
                  <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="font-semibold text-offwhite">{title}</h3>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-mist">{body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
