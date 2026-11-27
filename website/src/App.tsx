import { useEffect } from "react";
import { Header } from "./sections/Header";
import { CinemaHero } from "./sections/CinemaHero";
import { NightStory, Prologue } from "./sections/Story";
import { Showcase } from "./sections/Showcase";
import { MultiLocation } from "./sections/MultiLocation";
import { Implementation } from "./sections/Implementation";
import { Pricing } from "./sections/Pricing";
import { AiRoadmap } from "./sections/AiRoadmap";
import { About } from "./sections/About";
import { Faq } from "./sections/Faq";
import { DemoRequest } from "./sections/DemoRequest";
import { Footer } from "./sections/Footer";
import { WhatsAppFloat } from "./components/whatsapp";
import { SmoothScroll } from "./components/cinema/SmoothScroll";
import { FactsBand, Marquee, PointerFx } from "./components/cinema/fx";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { LegalPage } from "./sections/LegalPage";
import { pick, useLocale, type Locale } from "./i18n/locale";
import type { PageId } from "./i18n/meta";

/** The site: the home page, or a legal page (privacy policy, terms of use) when `page` names one. */
export function App({ initialLocale, page = "home" }: { initialLocale?: Locale; page?: PageId }) {
  return (
    <LocaleProvider page={page} {...(initialLocale ? { initial: initialLocale } : {})}>
      {page === "home" ? <Page /> : <LegalPage page={page} />}
    </LocaleProvider>
  );
}

/**
 * Opening the home page at a #section (a shared link, or a footer link on a legal page): the
 * pre-rendered HTML has no scroll-scene heights yet, so the browser's own jump lands short of the
 * section. Jump again once the app has laid the page out.
 */
function useScrollToHashOnLoad() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const target = document.getElementById(id);
        // scrollIntoView is missing in some test DOMs; real browsers all have it.
        if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start", behavior: "instant" });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/**
 * Cinematic version. The page tells one night of service:
 * opening film → prologue → 18:00 / 20:30 / 23:30 chapters → the product,
 * then locations, implementation, pricing, roadmap, about, FAQ and the demo request.
 */
function Page() {
  const { locale } = useLocale();
  useScrollToHashOnLoad();
  return (
    <>
      <SmoothScroll />
      <PointerFx />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-emerald focus:px-4 focus:py-2 focus:text-navy"
      >
        {pick(locale, "Skip to content", "Pular para o conteúdo")}
      </a>
      <Header />
      <main id="main">
        <CinemaHero />
        <Prologue />
        <Marquee
          items={pick(
            locale,
            ["Point of sale", "Kitchen display", "Inventory", "Purchasing", "Finance", "Team", "Locations"],
            ["Ponto de venda", "Tela da cozinha", "Estoque", "Compras", "Financeiro", "Equipe", "Unidades"],
          )}
        />
        <NightStory />
        <FactsBand />
        <Showcase />
        <MultiLocation />
        <Implementation />
        <Pricing />
        <AiRoadmap />
        <About />
        <Faq />
        <a href="#demo" className="block" aria-label={pick(locale, "Book a Demo", "Agendar demonstração")}>
          <Marquee tone="emerald" items={pick(locale, ["Book a demo", "See it with your menu"], ["Agende uma demonstração", "Veja com o seu cardápio"])} />
        </a>
        <DemoRequest />
      </main>
      <Footer />
      <WhatsAppFloat />
    </>
  );
}
