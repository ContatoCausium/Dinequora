import { Header } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { Positioning } from "./sections/Positioning";
import { PlatformOverview } from "./sections/PlatformOverview";
import { Features } from "./sections/Features";
import { Showcase } from "./sections/Showcase";
import { MultiLocation } from "./sections/MultiLocation";
import { CostControl } from "./sections/CostControl";
import { Implementation } from "./sections/Implementation";
import { Pricing } from "./sections/Pricing";
import { AiRoadmap } from "./sections/AiRoadmap";
import { About } from "./sections/About";
import { Faq } from "./sections/Faq";
import { DemoRequest } from "./sections/DemoRequest";
import { Footer } from "./sections/Footer";
import { WhatsAppFloat } from "./components/whatsapp";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { pick, useLocale, type Locale } from "./i18n/locale";

export function App({ initialLocale }: { initialLocale?: Locale }) {
  return (
    <LocaleProvider {...(initialLocale ? { initial: initialLocale } : {})}>
      <Page />
    </LocaleProvider>
  );
}

function Page() {
  const { locale } = useLocale();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-emerald focus:px-4 focus:py-2 focus:text-navy"
      >
        {pick(locale, "Skip to content", "Pular para o conteúdo")}
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Positioning />
        <PlatformOverview />
        <Features />
        <Showcase />
        <MultiLocation />
        <CostControl />
        <Implementation />
        <Pricing />
        <AiRoadmap />
        <About />
        <Faq />
        <DemoRequest />
      </main>
      <Footer />
      <WhatsAppFloat />
    </>
  );
}
