import { useEffect, useRef, useState } from "react";
import { cx, Reveal, SectionHeader, StatusBadge } from "../components/ui";
import { PauseButton, RotateProgress, useAutoRotate } from "../components/autoRotate";
import { AppWindow, ScaledFrame } from "../components/mockups/frame";
import { FinancePanel, InventoryPanel, KdsPanel, OverviewPanel, PosPanel } from "../components/mockups/panels";
import type { FeatureStatus } from "../content/features";
import { pick, useLocale, type Locale } from "../i18n/locale";

type View = {
  id: "kds" | "pos" | "inventory" | "finance" | "overview";
  label: string;
  caption: string;
  status: FeatureStatus;
};

function getViews(locale: Locale): View[] {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return [
    {
      id: "kds",
      label: t("Kitchen display", "Tela da cozinha"),
      caption: t(
        "Tickets flow from new to ready across four columns, filtered by station, with timers that flag late orders.",
        "Os pedidos passam de novos a prontos em quatro colunas, filtrados por estação, com cronômetros que destacam os atrasados.",
      ),
      status: "available",
    },
    {
      id: "pos",
      label: t("Point of sale", "Ponto de venda"),
      caption: t(
        "A fast, touch-friendly register for dine-in, takeout, and delivery, with discounts, held tickets, and tax.",
        "Um caixa rápido e fácil de usar no toque para consumo no local, retirada e entrega, com descontos, pedidos em espera e impostos.",
      ),
      status: "available",
    },
    {
      id: "inventory",
      label: t("Inventory", "Estoque"),
      caption: t(
        "Every ingredient with its supplier, quantity, and minimum, plus movements, recipes, suppliers, and purchase orders.",
        "Cada ingrediente com fornecedor, quantidade e mínimo, além de movimentações, fichas técnicas, fornecedores e pedidos de compra.",
      ),
      status: "available",
    },
    {
      id: "finance",
      label: t("Finance", "Financeiro"),
      caption: t(
        "Profit estimate, operating expenses, payables, and expense composition, with exportable statements and reports.",
        "Estimativa de lucro, despesas operacionais, contas a pagar e composição das despesas, com demonstrativos e relatórios exportáveis.",
      ),
      status: "available",
    },
    {
      id: "overview",
      label: t("Executive overview", "Visão executiva"),
      caption: t(
        "KPIs, revenue by location, alerts, and store comparison in one view. Being connected to live data now.",
        "Indicadores, faturamento por unidade, alertas e comparação entre unidades em uma só tela. Sendo conectada aos dados reais agora.",
      ),
      status: "rollingOut",
    },
  ];
}

function Screen({ id }: { id: View["id"] }) {
  switch (id) {
    case "kds":
      return (
        <AppWindow active="kds">
          <KdsPanel />
        </AppWindow>
      );
    case "pos":
      return (
        <AppWindow active="pos">
          <PosPanel />
        </AppWindow>
      );
    case "inventory":
      return (
        <AppWindow active="inventory">
          <InventoryPanel />
        </AppWindow>
      );
    case "finance":
      return (
        <AppWindow active="finance">
          <FinancePanel />
        </AppWindow>
      );
    case "overview":
      return (
        <AppWindow active="overview">
          <OverviewPanel />
        </AppWindow>
      );
  }
}

/** 0 while the stage is below the screen, 1 once its top reaches the upper fifth. */
function useTilt(ref: React.RefObject<HTMLDivElement | null>) {
  const [still] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [p, setP] = useState(0);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = window.innerHeight;
      const v = Math.min(1, Math.max(0, (h - top) / (h * 0.8)));
      setP((old) => (Math.abs(old - v) < 0.005 ? old : v));
    };
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [ref, still]);
  return still ? 1 : p;
}

export function Showcase() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const views = getViews(locale);
  const { active, select, next, running, userPaused, togglePause, bind } = useAutoRotate(views.length);
  const list = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tilt = useTilt(stage);
  const tiltStyle = {
    transform: `rotateX(${(1 - tilt) * 26}deg) scale(${0.84 + tilt * 0.16}) translateY(${(1 - tilt) * 60}px)`,
    opacity: 0.35 + tilt * 0.65,
  };
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Keep the active pill visible when the tab strip scrolls sideways (small screens).
  useEffect(() => {
    const el = list.current;
    const tab = tabs.current[active];
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: tab.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  return (
    <section aria-labelledby="showcase-title" className="relative overflow-hidden bg-navy py-24 sm:py-32">
      <div
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-0 mx-auto h-[600px] max-w-5xl rounded-full bg-emerald/[0.08] blur-[120px]"
        aria-hidden
      />
      <div className="container-page relative">
        <SectionHeader
          id="showcase-title"
          align="center"
          eyebrow={t("Inside the product", "Por dentro do produto")}
          title={
            <>
              {t("Designed for the pace ", "Pensado para o ritmo ")}
              <span className="accent-serif text-emerald">{t("of service.", "do serviço.")}</span>
            </>
          }
          lead={t(
            "Clear screens for every role, from the register to the line to the office. Explore the real layouts below.",
            "Telas claras para cada função, do caixa à cozinha e ao escritório. Explore abaixo os layouts reais do aplicativo.",
          )}
        />

        <Reveal className="mt-12">
          <div {...bind}>
            <div className="flex items-center justify-center gap-2">
              <div
                ref={list}
                role="tablist"
                aria-label={t("Product screens", "Telas do produto")}
                className="flex max-w-full min-w-0 gap-1 overflow-x-auto rounded-full border border-line-dark bg-navy-900/80 p-1 [scrollbar-width:none]"
              >
                {views.map((v, i) => {
                  const selected = i === active;
                  return (
                    <button
                      key={v.id}
                      ref={(el) => {
                        tabs.current[i] = el;
                      }}
                      role="tab"
                      type="button"
                      id={`screen-tab-${v.id}`}
                      aria-selected={selected}
                      aria-controls={`screen-panel-${v.id}`}
                      onClick={() => select(i)}
                      className={cx(
                        "relative shrink-0 overflow-hidden rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all duration-300",
                        selected ? "bg-offwhite text-navy" : "text-mist hover:text-offwhite",
                      )}
                    >
                      {v.label}
                      {selected && (
                        <span className="absolute inset-x-3 bottom-0.5 h-[2px] overflow-hidden rounded-full bg-navy/10">
                          <RotateProgress key={`${v.id}-${active}`} running={running} onDone={next} className="bg-emerald" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <PauseButton paused={userPaused} onToggle={togglePause} />
            </div>

            {/* Screens share one grid cell: height stays constant and screens crossfade. */}
            <div ref={stage} className="mt-10 grid grid-cols-[minmax(0,1fr)] [perspective:1800px]">
              <div className="grid grid-cols-[minmax(0,1fr)] will-change-transform [grid-area:1/1] [transform-style:preserve-3d]" style={tiltStyle}>
              {views.map((v, i) => {
                const isActive = i === active;
                return (
                  <div
                    key={v.id}
                    id={`screen-panel-${v.id}`}
                    role="tabpanel"
                    aria-labelledby={`screen-tab-${v.id}`}
                    aria-hidden={!isActive}
                    inert={!isActive}
                    className={cx(
                      "transition-[opacity,transform] duration-700 [grid-area:1/1]",
                      isActive ? "translate-y-0 opacity-100" : "invisible translate-y-3 opacity-0",
                    )}
                  >
                    <div className="mx-auto mb-6 flex min-h-12 max-w-2xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:text-left">
                      <StatusBadge status={v.status} />
                      <p className="text-sm leading-relaxed text-mist">{v.caption}</p>
                    </div>
                    <ScaledFrame width={1180}>
                      <Screen id={v.id} />
                    </ScaledFrame>
                  </div>
                );
              })}
              </div>
            </div>
            <p className="mt-5 text-center text-xs text-mist/60">
              {t(
                "Interface recreated from the Dinequora application with illustrative sample data.",
                "Interface recriada a partir do aplicativo Dinequora e traduzida para o português, com dados ilustrativos de exemplo. Hoje o aplicativo é em inglês.",
              )}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
