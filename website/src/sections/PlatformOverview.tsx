import { BookOpenText, Boxes, CookingPot, Landmark, MonitorSmartphone, UsersRound, type LucideIcon } from "lucide-react";
import { cx, Reveal, SectionHeader } from "../components/ui";
import { PauseButton, RotateProgress, useAutoRotate } from "../components/autoRotate";
import { pick, useLocale, type Locale } from "../i18n/locale";

type Stage = { id: string; label: string; icon: LucideIcon; title: string; body: string };

function getStages(locale: Locale): Stage[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return [
    {
      id: "menu",
      label: t("Menu", "Cardápio"),
      icon: BookOpenText,
      title: t("One menu, published to every location", "Um cardápio, publicado em todas as unidades"),
      body: t(
        "Build categories and modifiers once and choose where each item is available. Prices are set centrally and calculated on the server at checkout.",
        "Monte categorias e complementos uma vez e escolha onde cada item fica disponível. Os preços são definidos de forma central e calculados no servidor no fechamento.",
      ),
    },
    {
      id: "pos",
      label: t("Point of sale", "PDV"),
      icon: MonitorSmartphone,
      title: t("Fast tickets for the floor", "Pedidos rápidos no salão"),
      body: t(
        "Dine-in, takeout, and delivery tickets with discounts and held orders. Every completed sale is recorded with its payment method.",
        "Pedidos para consumo no local, retirada e entrega, com descontos e pedidos em espera. Cada venda concluída é registrada com a forma de pagamento.",
      ),
    },
    {
      id: "kds",
      label: t("Kitchen", "Cozinha"),
      icon: CookingPot,
      title: t("A calm, live kitchen queue", "Uma fila da cozinha tranquila e ao vivo"),
      body: t(
        "Tickets arrive on the kitchen display as soon as they are sent, move from new to ready, and flag themselves when they run long.",
        "Os pedidos chegam à tela da cozinha assim que são enviados, passam de novos a prontos e ficam destacados quando atrasam.",
      ),
    },
    {
      id: "inventory",
      label: t("Inventory", "Estoque"),
      icon: Boxes,
      title: t("Stock that keeps up with service", "Um estoque que acompanha o serviço"),
      body: t(
        "Ingredient levels, movements, suppliers, purchase orders, and receiving in one place, with low-stock and out-of-stock flags.",
        "Níveis de ingredientes, movimentações, fornecedores, pedidos de compra e recebimento em um só lugar, com alertas de estoque baixo e zerado.",
      ),
    },
    {
      id: "finance",
      label: t("Finance", "Financeiro"),
      icon: Landmark,
      title: t("The back office, without the backlog", "O escritório, sem papelada acumulada"),
      body: t(
        "Revenue from every sale lands next to your expenses and payables, ready for cash flow statements and exportable reports.",
        "O faturamento de cada venda fica ao lado das despesas e contas a pagar, pronto para o fluxo de caixa e para relatórios exportáveis.",
      ),
    },
    {
      id: "team",
      label: t("Team", "Equipe"),
      icon: UsersRound,
      title: t("Access that matches each role", "Acesso de acordo com cada função"),
      body: t(
        "Owners see everything. Managers and staff see only the locations and screens they need, and sensitive changes are logged.",
        "Donos veem tudo. Gerentes e funcionários veem só as unidades e telas de que precisam, e alterações sensíveis ficam registradas.",
      ),
    },
  ];
}

export function PlatformOverview() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const stages = getStages(locale);
  const { active, select: setActive, next, running, userPaused, togglePause, bind } = useAutoRotate(stages.length);
  const stage = stages[active] ?? stages[0]!;

  return (
    <section id="platform" aria-labelledby="platform-title" className="relative overflow-hidden bg-navy py-24 sm:py-32">
      <div className="grid-fade pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="container-page relative">
        <SectionHeader
          id="platform-title"
          eyebrow={t("Platform overview", "Visão geral da plataforma")}
          title={
            <>
              {t("Every station, ", "Cada posto, ")}
              <span className="accent-serif text-emerald">{t("one system.", "um só sistema.")}</span>
            </>
          }
          lead={t(
            "Dinequora follows a ticket from the menu to the kitchen to the books. Each step feeds the next, so nobody re-enters data and every number has a source.",
            "O Dinequora acompanha o pedido do cardápio à cozinha e às finanças. Cada etapa alimenta a próxima, então ninguém digita nada duas vezes e todo número tem origem.",
          )}
        />

        <Reveal className="mt-14">
          <div {...bind}>
          <div role="tablist" aria-label={t("Platform stages", "Etapas da plataforma")} className="relative grid grid-cols-3 gap-2 sm:grid-cols-6">
            <div aria-hidden className="absolute top-7 right-[8%] left-[8%] hidden h-px bg-gradient-to-r from-emerald/0 via-emerald/40 to-emerald/0 sm:block" />
            {stages.map((s, i) => {
              const Icon = s.icon;
              const selected = i === active;
              return (
                <button
                  key={s.id}
                  role="tab"
                  type="button"
                  id={`stage-tab-${s.id}`}
                  aria-selected={selected}
                  aria-controls="stage-panel"
                  onClick={() => setActive(i)}
                  className="group relative flex flex-col items-center gap-3 rounded-xl py-2 text-center"
                >
                  <span
                    className={cx(
                      "relative grid size-14 place-items-center rounded-2xl border transition-all duration-500",
                      selected
                        ? "border-emerald/60 bg-emerald/15 text-emerald shadow-[0_0_40px_-6px_rgb(16_185_129/0.6)]"
                        : "border-line-dark bg-navy-900 text-mist group-hover:border-mist/30 group-hover:text-offwhite",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className={cx("text-sm font-medium transition-colors", selected ? "text-offwhite" : "text-mist")}>
                    <span className="mr-1 text-xs text-mist/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            id="stage-panel"
            role="tabpanel"
            aria-labelledby={`stage-tab-${stage.id}`}
            className="surface-dark mt-10 grid overflow-hidden rounded-3xl lg:grid-cols-[1.05fr_1fr]"
          >
            <div key={stage.id} className="rise flex flex-col justify-center p-8 sm:p-12">
              <p className="eyebrow text-emerald">{t("Step", "Etapa")} {String(active + 1).padStart(2, "0")} · {stage.label}</p>
              <h3 className="heading mt-4 text-2xl text-offwhite sm:text-[2rem]">{stage.title}</h3>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-mist sm:text-lg">{stage.body}</p>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex flex-1 gap-1.5" aria-hidden>
                  {stages.map((s, i) => (
                    <span key={s.id} className="h-1 max-w-12 flex-1 overflow-hidden rounded-full bg-mist/15">
                      {i < active && <span className="block h-full w-full bg-emerald/60" />}
                      {i === active && <RotateProgress key={`${s.id}-${active}`} running={running} onDone={next} className="bg-emerald" />}
                    </span>
                  ))}
                </div>
                <PauseButton paused={userPaused} onToggle={togglePause} />
              </div>
            </div>
            <div className="relative min-h-[260px] overflow-hidden">
              <img
                src="/images/interior-modern.webp"
                alt={t("Modern restaurant dining room during evening service", "Salão de restaurante moderno durante o serviço da noite")}
                width={1600}
                height={1067}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-navy-900/90 via-navy-900/20 to-transparent lg:from-[#111b2e]" aria-hidden />
            </div>
          </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
