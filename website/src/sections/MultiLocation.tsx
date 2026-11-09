import { Check } from "lucide-react";
import { Reveal, SectionHeader } from "../components/ui";
import { LocationAccessCard, StoreComparisonCard } from "../components/mockups/panels";
import { pick, useLocale } from "../i18n/locale";

const points = {
  en: [
    "Add locations with their own hours, time zone, and managers",
    "Make menu items available per location",
    "Assign managers and staff to specific locations only",
    "Compare orders and expenses across locations in Finance",
    "Your plan sets the number of active locations: 1, up to 3, or up to 50",
  ],
  pt: [
    "Cadastre unidades com horários, fuso horário e gerentes próprios",
    "Defina em quais unidades cada item do cardápio fica disponível",
    "Vincule gerentes e funcionários apenas a unidades específicas",
    "Compare pedidos e despesas entre unidades no Financeiro",
    "Seu plano define o número de unidades ativas: 1, até 3 ou até 50",
  ],
};

export function MultiLocation() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return (
    <section aria-labelledby="multi-title" className="relative overflow-hidden bg-navy-950 py-24 sm:py-32">
      <div className="absolute inset-0" aria-hidden>
        <img
          src="/images/kitchen-fire.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover opacity-[0.22]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#070C15_25%,rgb(7_12_21/0.85)_55%,rgb(7_12_21/0.6)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#070C15,transparent_20%,transparent_80%,#070C15)]" />
      </div>

      <div className="container-page relative grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <SectionHeader
            id="multi-title"
            eyebrow={t("Multi-location management", "Gestão de várias unidades")}
            title={
              <>
                {t("One group. Every room. ", "Um grupo. Todas as casas. ")}
                <span className="accent-serif text-emerald">{t("Under control.", "Sob controle.")}</span>
              </>
            }
            lead={t(
              "Whether you are opening a second location or running a group, Dinequora keeps each location separate where it should be and connected where it counts.",
              "Seja abrindo a segunda unidade ou comandando um grupo, o Dinequora mantém cada unidade separada onde deve ser e conectada onde importa.",
            )}
          />
          <Reveal as="ul" delay={120} className="mt-9 space-y-3.5">
            {points[locale].map((p) => (
              <li key={p} className="flex gap-3 text-[0.98rem] text-offwhite/90">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald/15 text-emerald">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
                {p}
              </li>
            ))}
          </Reveal>
        </div>

        <Reveal delay={160} className="relative">
          <div className="space-y-4 sm:pl-10">
            <div className="sm:-ml-10 sm:mr-10">
              <StoreComparisonCard />
            </div>
            <LocationAccessCard />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
