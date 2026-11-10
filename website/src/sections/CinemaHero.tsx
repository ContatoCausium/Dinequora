import { ButtonLink } from "../components/ui";
import { FilmScene, Moment, type FrameSet } from "../components/cinema/scene";
import { DEMO_ANCHOR } from "../config/site";
import { formatUsd, PRICES } from "../config/pricing";
import { pick, useLocale } from "../i18n/locale";

const OPENING: FrameSet = { dir: "/frames/abertura", total: 144 };

/** Opening film: the camera walks in from the street to the kitchen pass as the visitor scrolls. */
export function CinemaHero() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const from = formatUsd(PRICES.starter.monthlyUsd, locale);

  return (
    <FilmScene
      id="top"
      frames={OPENING}
      poster="/frames/abertura/d/001.webp"
      height={420}
      label={t("Opening film", "Filme de abertura")}
    >
      {(p) => (
        <>
          {/* Legibility: darker top for the header, darker bottom/left for the copy. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(7_12_21/0.75)_0%,transparent_22%,transparent_55%,rgb(7_12_21/0.85)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_50%,rgb(7_12_21/0.55)_100%)]" />

          <div className="container-page relative flex h-full items-end pb-[11vh]">
            <Moment p={p} from={0} to={0.3} className="max-w-[640px]">
              <div className="cine-panel">
                <p className="eyebrow text-emerald">{t("Restaurant Intelligence Platform", "Plataforma de Inteligência para Restaurantes")}</p>
                <h1 id="hero-title" className="display mt-5 text-[2.6rem] text-offwhite sm:text-6xl lg:text-[4.4rem]">
                  {t("Run your restaurant.", "Comande seu restaurante.")}{" "}
                  <span className="accent-serif text-emerald">{t("Not the chaos.", "Não o caos.")}</span>
                </h1>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-mist">
                  {t(
                    "Orders, kitchen, inventory, and finance in one system, built for the pace of service.",
                    "Pedidos, cozinha, estoque e financeiro em um só sistema, feito para o ritmo do serviço.",
                  )}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <ButtonLink href={DEMO_ANCHOR} size="lg" arrow>
                    {t("Book a Demo", "Agendar demonstração")}
                  </ButtonLink>
                  <ButtonLink href="#platform" tone="ghost" size="lg">
                    {t("Explore the Platform", "Conhecer a plataforma")}
                  </ButtonLink>
                </div>
              </div>
            </Moment>

            <Moment p={p} from={0.36} to={0.66} className="absolute right-5 bottom-[11vh] left-5 sm:right-8 sm:left-auto sm:max-w-[520px] lg:right-[max(2rem,calc((100vw-1240px)/2+2rem))]">
              <div className="cine-panel">
                <p className="eyebrow text-mist/80">{t("One system", "Um só sistema")}</p>
                <p className="mt-4 text-2xl leading-snug font-medium text-offwhite sm:text-[2rem]">
                  {t("The floor, the line, the stockroom and the office, ", "O salão, a cozinha, o estoque e o escritório, ")}
                  <span className="accent-serif text-emerald">{t("in sync.", "em sincronia.")}</span>
                </p>
                <p className="mt-4 text-mist">
                  {t(
                    "A ticket rung up at the POS reaches the kitchen display, moves stock, and lands in your reports.",
                    "O pedido lançado no caixa chega à tela da cozinha, movimenta o estoque e entra nos seus relatórios.",
                  )}
                </p>
              </div>
            </Moment>

            <Moment p={p} from={0.72} to={1} className="absolute inset-x-5 bottom-[11vh] mx-auto max-w-[620px] text-center">
              <div className="cine-panel">
                <p className="text-2xl leading-snug font-medium text-offwhite sm:text-[2rem]">
                  {t("Follow one night of service, ", "Acompanhe uma noite de serviço, ")}
                  <span className="accent-serif text-emerald">{t("open to close.", "da abertura ao fechamento.")}</span>
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
            className="scroll-cue absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[10px] tracking-[0.3em] text-offwhite/60 uppercase transition-opacity duration-500"
            style={{ opacity: p > 0.03 ? 0 : 1 }}
          >
            <span />
            {t("Scroll", "Role")}
          </div>
        </>
      )}
    </FilmScene>
  );
}
