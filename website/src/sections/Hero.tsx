import { useEffect, useRef, type CSSProperties } from "react";
import { DEMO_ANCHOR } from "../config/site";
import { ButtonLink } from "../components/ui";
import { pick, useLocale } from "../i18n/locale";
import { AppWindow, ScaledFrame } from "../components/mockups/frame";
import { FinancePanel, KitchenNotice, StockNotice } from "../components/mockups/panels";

export function Hero() {
  const photo = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);

  // Subtle parallax on the background photograph.
  useEffect(() => {
    const el = photo.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 900);
        el.style.transform = `translate3d(0, ${y * 0.25}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-navy pt-[68px]">
      {/* Cinematic background */}
      <div className="absolute inset-0 -z-10 h-[min(100svh,980px)] overflow-hidden" aria-hidden>
        <div ref={photo} className="absolute inset-0 will-change-transform">
          <img
            src="/images/hero-dining.webp"
            alt=""
            width={2200}
            height={1238}
            fetchPriority="high"
            className="kenburns h-full w-full object-cover object-center opacity-[0.55]"
          />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#0B1320_8%,rgb(11_19_32/0.82)_42%,rgb(11_19_32/0.35)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(11_19_32/0.65)_0%,transparent_30%,transparent_55%,#0B1320_96%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_75%_95%,rgb(16_185_129/0.18),transparent_70%)]" />
      </div>

      <div className="container-page relative pt-16 sm:pt-24 lg:pt-28">
        <div className="max-w-[46rem]">
          <p className="rise eyebrow text-emerald" style={{ "--rise-delay": "80ms" } as CSSProperties}>
            <span aria-hidden className="h-px w-6 bg-emerald/70" />
            {t("Restaurant Intelligence Platform", "Plataforma de inteligência para restaurantes")}
          </p>
          <h1
            id="hero-title"
            className="rise display mt-6 text-[2.85rem] text-offwhite sm:text-[4.4rem] lg:text-[5.4rem]"
            style={{ "--rise-delay": "160ms" } as CSSProperties}
          >
            {t("Run your restaurant.", "Comande seu restaurante.")}
            <br />
            <span className="accent-serif text-[1.08em] text-offwhite/95">{t("Not the chaos.", "Não o caos.")}</span>
          </h1>
          <p
            className="rise mt-7 max-w-[36rem] text-lg leading-relaxed text-mist sm:text-xl"
            style={{ "--rise-delay": "260ms" } as CSSProperties}
          >
            {t(
              "One intelligent platform to manage your restaurant operations, control costs, empower your team, and make better business decisions.",
              "Uma plataforma inteligente para gerenciar a operação do seu restaurante, controlar custos, dar autonomia à equipe e tomar decisões melhores.",
            )}
          </p>
          <div
            className="rise mt-10 flex flex-col gap-3 sm:flex-row sm:items-center"
            style={{ "--rise-delay": "360ms" } as CSSProperties}
          >
            <ButtonLink href={DEMO_ANCHOR} size="lg" arrow>
              {t("Book a Demo", "Agendar demonstração")}
            </ButtonLink>
            <ButtonLink href="#platform" size="lg" tone="ghost">
              {t("Explore the Platform", "Conhecer a plataforma")}
            </ButtonLink>
          </div>
          <ul
            className="rise mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-mist/80"
            style={{ "--rise-delay": "440ms" } as CSSProperties}
          >
            {t(
              ["Point of sale", "Kitchen display", "Inventory & purchasing", "Finance", "Team permissions"],
              ["Ponto de venda", "Tela da cozinha", "Estoque e compras", "Financeiro", "Permissões da equipe"],
            ).map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span aria-hidden className="size-1 rounded-full bg-emerald" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Product composition */}
        <div className="rise relative mt-16 pb-20 sm:mt-20 lg:mt-24" style={{ "--rise-delay": "520ms" } as CSSProperties}>
          <div className="pointer-events-none absolute -inset-x-10 top-10 -z-10 h-2/3 rounded-[50%] bg-emerald/10 blur-3xl" aria-hidden />
          <figure className="relative">
            <ScaledFrame width={1180}>
              <AppWindow active="finance">
                <FinancePanel />
              </AppWindow>
            </ScaledFrame>
            {/* Two matching notification cards that sit just outside the window edges (wide screens only). */}
            <div className="float-y absolute -top-12 -right-10 hidden 2xl:-right-16 xl:block" aria-hidden>
              <KitchenNotice />
            </div>
            <div
              className="float-y absolute -bottom-14 -left-10 hidden 2xl:-left-16 xl:block"
              style={{ "--float-delay": "-3.5s" } as CSSProperties}
              aria-hidden
            >
              <StockNotice />
            </div>
            <figcaption className="mt-5 text-center text-xs text-mist/60">
              {t(
                "Dinequora interface shown with illustrative sample data.",
                "Interface do Dinequora com dados ilustrativos de exemplo, traduzida para o português. O aplicativo hoje é em inglês.",
              )}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
