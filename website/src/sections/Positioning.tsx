import { Building2, ChefHat, LineChart, Store } from "lucide-react";
import { Reveal } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";

const audiences = {
  en: [
    {
      icon: Store,
      title: "Independent restaurants",
      body: "One location, one owner wearing every hat. Replace spreadsheets and paper tickets with one system.",
    },
    {
      icon: Building2,
      title: "Multi-location groups",
      body: "Run several rooms with consistent menus, shared suppliers, and access scoped to each location.",
    },
    {
      icon: LineChart,
      title: "Owners and general managers",
      body: "See revenue, expenses, and payables without waiting for month-end, and export what your accountant needs.",
    },
    {
      icon: ChefHat,
      title: "Kitchen and floor teams",
      body: "A fast register for the floor and a clear ticket queue for the line, with only the screens each role needs.",
    },
  ],
  pt: [
    {
      icon: Store,
      title: "Restaurantes independentes",
      body: "Uma unidade e um dono que faz de tudo. Troque planilhas e comandas de papel por um único sistema.",
    },
    {
      icon: Building2,
      title: "Grupos com várias unidades",
      body: "Opere várias casas com cardápios padronizados, fornecedores em comum e acesso limitado a cada unidade.",
    },
    {
      icon: LineChart,
      title: "Donos e gerentes gerais",
      body: "Veja faturamento, despesas e contas a pagar sem esperar o fechamento do mês e exporte o que o contador precisa.",
    },
    {
      icon: ChefHat,
      title: "Equipes de cozinha e salão",
      body: "Um caixa rápido para o salão e uma fila de pedidos clara para a cozinha, com só as telas que cada função precisa.",
    },
  ],
};

export function Positioning() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return (
    <section aria-labelledby="positioning-title" className="relative border-y border-line-dark bg-navy-950 py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <h2 id="positioning-title" className="heading text-3xl text-offwhite sm:text-[2.6rem]">
            {t("Built for the way restaurants ", "Feito para o jeito que os restaurantes ")}
            <span className="accent-serif text-emerald">{t("actually run.", "funcionam de verdade.")}</span>
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-mist sm:text-lg lg:justify-self-end">
            {t(
              "Service doesn't wait for software. Dinequora connects the register, the kitchen, the stockroom, and the back office so the whole team works from the same information.",
              "O serviço não espera pelo sistema. O Dinequora conecta o caixa, a cozinha, o estoque e o escritório para que toda a equipe trabalhe com as mesmas informações.",
            )}
          </p>
        </Reveal>
        <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line-dark bg-line-dark sm:grid-cols-2 lg:grid-cols-4">
          {audiences[locale].map(({ icon: Icon, title, body }, i) => (
            <Reveal as="li" key={title} delay={i * 80} className="bg-navy-950 p-7 transition-colors duration-500 hover:bg-navy-900">
              <Icon aria-hidden className="size-5 text-emerald" strokeWidth={1.75} />
              <h3 className="mt-6 text-[1.05rem] font-semibold text-offwhite">{title}</h3>
              <p className="mt-2.5 text-[0.95rem] leading-relaxed text-mist">{body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
