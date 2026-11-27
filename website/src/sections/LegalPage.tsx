import { ArrowLeft } from "lucide-react";
import { COMPANY, MISSING_FACT_LABELS, type CompanyFacts } from "../config/company";
import { LanguageSwitcher, Logo } from "../components/ui";
import { WhatsAppFloat } from "../components/whatsapp";
import { Footer } from "./Footer";
import { pick, useLocale, type Locale } from "../i18n/locale";
import { pagePath, type LegalPageId } from "../i18n/meta";
import { privacyPolicy } from "../legal/privacy";
import type { Block, Inline, LegalDocument } from "../legal/types";

const documents: Record<LegalPageId, Record<Locale, LegalDocument>> = {
  privacy: privacyPolicy,
};

/** A company fact, or a visible "[preencher: …]" marker while the owner has not given it. */
function Fact({ name, locale }: { name: keyof CompanyFacts; locale: Locale }) {
  const value = COMPANY[name];
  if (value === null) {
    return (
      <mark data-missing-fact={name} className="rounded bg-amber/15 px-1 font-semibold text-amber ring-1 ring-inset ring-amber/40">
        {`[preencher: ${MISSING_FACT_LABELS[name]}]`}
      </mark>
    );
  }
  if (typeof value === "object") return <>{value[locale]}</>;
  if (name === "contactEmail") {
    return (
      <a href={`mailto:${value}`} className="text-emerald underline underline-offset-4 hover:text-emerald-soft">
        {value}
      </a>
    );
  }
  return <>{value}</>;
}

function Inlines({ items, locale }: { items: Inline[]; locale: Locale }) {
  return (
    <>
      {items.map((item, i) => {
        if (typeof item === "string") return <span key={i}>{item}</span>;
        if ("fact" in item) return <Fact key={i} name={item.fact} locale={locale} />;
        if ("strong" in item) return <strong key={i} className="font-semibold text-offwhite">{item.strong}</strong>;
        return (
          <a
            key={i}
            href={item.href}
            {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-emerald underline underline-offset-4 hover:text-emerald-soft"
          >
            {item.label}
          </a>
        );
      })}
    </>
  );
}

function BlockView({ block, locale }: { block: Block; locale: Locale }) {
  if ("p" in block) {
    return (
      <p className="mt-4 leading-relaxed text-mist">
        <Inlines items={block.p} locale={locale} />
      </p>
    );
  }
  return (
    <ul className="mt-4 list-disc space-y-2.5 pl-5 leading-relaxed text-mist marker:text-emerald/70">
      {block.ul.map((item, i) => (
        <li key={i}>
          <Inlines items={item} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

/** A legal page (privacy policy): its own light header, the document, and the site footer. */
export function LegalPage({ page }: { page: LegalPageId }) {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const doc = documents[page][locale];
  const home = pagePath("home", locale);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-emerald focus:px-4 focus:py-2 focus:text-navy"
      >
        {t("Skip to content", "Pular para o conteúdo")}
      </a>
      <header className="border-b border-line-dark bg-navy">
        <div className="container-page flex h-[68px] items-center justify-between gap-4">
          <a href={home} className="-ml-1 shrink-0 rounded-md" aria-label={t("Dinequora home", "Dinequora, início")}>
            <Logo variant="full-dark" className="h-[44px] w-auto" />
          </a>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <a
              href={home}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-[0.9rem] font-medium text-mist transition-colors hover:text-offwhite sm:inline-flex"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t("Back to the site", "Voltar ao site")}
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="container-page py-14 sm:py-20">
        <article className="mx-auto max-w-3xl">
          <p className="eyebrow text-emerald">
            <span aria-hidden className="h-px w-6 bg-emerald/70" />
            {t("Legal", "Jurídico")}
          </p>
          <h1 className="heading mt-5 text-[2.3rem] text-offwhite sm:text-5xl">{doc.title}</h1>
          <p className="mt-5 text-base leading-relaxed text-mist sm:text-lg">{doc.lead}</p>
          <p className="mt-4 text-sm text-mist/80">
            {t("Effective date: ", "Vigência: ")}
            <Fact name="effectiveDate" locale={locale} />
          </p>
          {doc.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="mt-12 border-t border-line-dark pt-10">
              <h2 id={section.id} className="heading text-2xl text-offwhite sm:text-[1.7rem]">
                {section.heading}
              </h2>
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} locale={locale} />
              ))}
            </section>
          ))}
        </article>
      </main>
      <Footer />
      <WhatsAppFloat />
    </>
  );
}
