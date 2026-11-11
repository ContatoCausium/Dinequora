import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ButtonLink } from "../components/ui";
import { FilmScene, Moment, segment, type FrameSet } from "../components/cinema/scene";
import { DEMO_ANCHOR } from "../config/site";
import { formatUsd, PRICES } from "../config/pricing";
import { pick, useLocale } from "../i18n/locale";

const OPENING: FrameSet = { dir: "/frames/abertura", total: 144 };

const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * The film plays inside the letters of the name. Scrolling dives into the stem of the "I"
 * until the picture fills the screen. Built as an SVG mask so the letters stay sharp at any zoom.
 */
function MaskedName({ p }: { p: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const text = useRef<SVGTextElement>(null);
  const [origin, setOrigin] = useState("50% 50%");
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);

  // Find the centre of the "I" stem in screen space, so the zoom lands inside the letter.
  useEffect(() => {
    const place = () => {
      setNarrow(window.innerWidth < 760);
      const el = svg.current;
      const t = text.current;
      if (!el || !t || typeof t.getExtentOfChar !== "function") return;
      try {
        const box = t.getExtentOfChar(1); // "I"
        const ctm = t.getScreenCTM();
        const host = el.getBoundingClientRect();
        if (!ctm) return;
        const pt = el.createSVGPoint();
        pt.x = box.x + box.width / 2;
        pt.y = box.y + box.height * 0.55;
        const s = pt.matrixTransform(ctm);
        setOrigin(`${s.x - host.left}px ${s.y - host.top}px`);
      } catch {
        /* jsdom or an old engine: keep the centre */
      }
    };
    place();
    const id = window.setTimeout(place, 400); // after the font has loaded
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", place);
    };
  }, [narrow]);

  const z = ease(segment(p, 0.03, 0.2));
  const scale = 1 + Math.pow(z, 3) * 90;
  const gone = segment(p, 0.17, 0.21);
  const view = narrow ? { w: 900, h: 1600, size: 190, y: 430, x: 450 } : { w: 1600, h: 900, size: 218, y: 500, x: 800 };

  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" style={{ opacity: 1 - gone, visibility: gone >= 1 ? "hidden" : "visible" }} aria-hidden>
      <svg
        ref={svg}
        className="h-full w-full will-change-transform"
        viewBox={`0 0 ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ transform: `scale(${scale})`, transformOrigin: origin } as CSSProperties}
      >
        <defs>
          <mask id="dq-name-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
            <rect width={view.w} height={view.h} fill="white" />
            <text
              ref={text}
              x={view.x}
              y={view.y}
              textAnchor="middle"
              fontFamily="Inter Variable, Inter, system-ui, sans-serif"
              fontWeight={850}
              fontSize={view.size}
              letterSpacing={narrow ? -6 : -6}
              fill="black"
            >
              {narrow ? (
                <>
                  <tspan x={view.x} dy="0">
                    DINE
                  </tspan>
                  <tspan x={view.x} dy="200">
                    QUORA
                  </tspan>
                </>
              ) : (
                "DINEQUORA"
              )}
            </text>
          </mask>
        </defs>
        <rect width={view.w} height={view.h} fill="#070c15" mask="url(#dq-name-mask)" />
      </svg>
    </div>
  );
}

/** Opening film: the name opens into the restaurant, then the camera walks to the kitchen pass. */
export function CinemaHero() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const from = formatUsd(PRICES.starter.monthlyUsd, locale);

  return (
    <FilmScene id="top" frames={OPENING} poster="/frames/abertura/d/001.webp" height={520} label={t("Opening film", "Filme de abertura")}>
      {(p) => (
        <>
          {/* Legibility veils for the copy over the film. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(7_12_21/0.7)_0%,transparent_22%,transparent_55%,rgb(7_12_21/0.85)_100%)]" />
          <MaskedName p={p} />

          {/* First beat: sits under the name while the film is still inside the letters. */}
          <div className="container-page relative z-[2] flex h-full items-end pb-[9vh]">
            <Moment p={p} from={0} to={0.08} className="w-full">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <h1 id="hero-title" className="display text-[2.3rem] text-offwhite sm:text-5xl lg:text-[3.4rem]">
                    {t("Run your restaurant.", "Comande seu restaurante.")}{" "}
                    <span className="text-emerald">{t("Not the chaos.", "Não o caos.")}</span>
                  </h1>
                  <p className="mt-4 max-w-md text-lg leading-relaxed text-mist">
                    {t(
                      "Orders, kitchen, inventory, and finance in one system, built for the pace of service.",
                      "Pedidos, cozinha, estoque e financeiro em um só sistema, feito para o ritmo do serviço.",
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <ButtonLink href={DEMO_ANCHOR} size="lg" arrow data-magnetic>
                    {t("Book a Demo", "Agendar demonstração")}
                  </ButtonLink>
                  <ButtonLink href="#platform" tone="ghost" size="lg">
                    {t("Explore the Platform", "Conhecer a plataforma")}
                  </ButtonLink>
                </div>
              </div>
            </Moment>

            <Moment
              p={p}
              from={0.3}
              to={0.6}
              className="absolute right-5 bottom-[11vh] left-5 sm:right-8 sm:left-auto sm:max-w-[520px] lg:right-[max(2rem,calc((100vw-1240px)/2+2rem))]"
            >
              <div className="cine-panel">
                <p className="eyebrow text-mist/80">{t("One system", "Um só sistema")}</p>
                <p className="mt-4 text-2xl leading-snug font-medium text-offwhite sm:text-[2rem]">
                  {t("The floor, the line, the stockroom and the office, ", "O salão, a cozinha, o estoque e o escritório, ")}
                  <span className="text-emerald">{t("in sync.", "em sincronia.")}</span>
                </p>
                <p className="mt-4 text-mist">
                  {t(
                    "A ticket rung up at the POS reaches the kitchen display, moves stock, and lands in your reports.",
                    "O pedido lançado no caixa chega à tela da cozinha, movimenta o estoque e entra nos seus relatórios.",
                  )}
                </p>
              </div>
            </Moment>

            <Moment p={p} from={0.7} to={1} className="absolute inset-x-5 bottom-[11vh] mx-auto max-w-[620px] text-center">
              <div className="cine-panel">
                <p className="text-2xl leading-snug font-medium text-offwhite sm:text-[2rem]">
                  {t("Follow one night of service, ", "Acompanhe uma noite de serviço, ")}
                  <span className="text-emerald">{t("open to close.", "da abertura ao fechamento.")}</span>
                </p>
                <p className="mt-4 text-mist">
                  {t(
                    `Keep scrolling. Plans start at ${from}/month plus a one-time implementation.`,
                    `Continue rolando. Planos a partir de ${from}/mês, mais a implantação cobrada uma única vez.`,
                  )}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <ButtonLink href="#pricing" tone="ghost">
                    {t("See plans and pricing", "Ver planos e preços")}
                  </ButtonLink>
                </div>
              </div>
            </Moment>
          </div>

          <div
            aria-hidden
            className="scroll-cue absolute bottom-5 left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-2 text-[10px] tracking-[0.3em] text-offwhite/60 uppercase transition-opacity duration-500"
            style={{ opacity: p > 0.02 ? 0 : 1 }}
          >
            <span />
            {t("Scroll", "Role")}
          </div>
        </>
      )}
    </FilmScene>
  );
}
