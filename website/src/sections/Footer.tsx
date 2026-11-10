import { appRoutes, DEMO_ANCHOR, WHATSAPP, whatsappGreeting, whatsappUrl } from "../config/site";
import { Logo } from "../components/ui";
import { UnavailableAction } from "../components/appAccess";
import { WhatsAppIcon } from "../components/whatsapp";
import { pick, useLocale, type Locale } from "../i18n/locale";

function getColumns(locale: Locale) {
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  return [
    {
      title: t("Product", "Produto"),
      links: [
        { label: t("Platform", "Plataforma"), href: "#platform" },
        { label: t("Features", "Recursos"), href: "#features" },
        { label: t("Pricing", "Preços"), href: "#pricing" },
        { label: t("Implementation", "Implantação"), href: "#implementation" },
      ],
    },
    {
      title: t("Company", "Empresa"),
      links: [
        { label: t("About", "Sobre"), href: "#about" },
        { label: t("FAQ", "Perguntas frequentes"), href: "#faq" },
        { label: t("Book a Demo", "Agendar demonstração"), href: DEMO_ANCHOR },
      ],
    },
    {
      title: t("Account", "Conta"),
      // While the app is not published (appRoutes is null) both entries render as "Coming soon".
      links: [
        {
          label: t("Login", "Entrar"),
          href: appRoutes?.login ?? null,
          soon: t("Login — coming soon", "Entrar — em breve"),
        },
        {
          label: t("Create account", "Criar conta"),
          href: appRoutes?.signup ?? null,
          soon: t("Create account — coming soon", "Criar conta — em breve"),
        },
      ],
    },
  ] satisfies Array<{ title: string; links: Array<{ label: string; href: string | null; soon?: string }> }>;
}

export function Footer() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const columns = getColumns(locale);
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line-dark bg-navy">
      <div className="container-page py-16 sm:py-20">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo variant="full-dark" className="-ml-3 h-16 w-auto" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist">
              {t(
                "Restaurant management for independent restaurants and multi-location groups in the United States.",
                "Gestão para restaurantes independentes e grupos com várias unidades nos Estados Unidos.",
              )}
            </p>
            <a
              href={whatsappUrl(whatsappGreeting[locale])}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 text-sm text-offwhite ring-1 ring-inset ring-line-dark transition-colors hover:ring-emerald/50"
            >
              <span className="grid size-8 place-items-center rounded-full bg-emerald text-navy">
                <WhatsAppIcon className="size-4" />
              </span>
              <span>
                <span className="block text-[0.68rem] font-semibold tracking-[0.14em] text-mist/70 uppercase">
                  {t("Sales · WhatsApp", "Comercial · WhatsApp")}
                </span>
                <span className="font-medium tabular-nums">{WHATSAPP.display}</span>
              </span>
            </a>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-xs font-semibold tracking-[0.16em] text-mist/70 uppercase">{col.title}</h3>
              <ul className="mt-5 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href !== null ? (
                      <a href={l.href} className="text-sm text-mist transition-colors hover:text-offwhite">
                        {l.label}
                      </a>
                    ) : (
                      <UnavailableAction
                        label={l.label}
                        accessibleName={"soon" in l && l.soon ? l.soon : l.label}
                        className="inline-flex text-sm text-mist/60"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-line-dark pt-8 text-xs text-mist/60 sm:flex-row sm:justify-between">
          <p>© {year} Dinequora. {t("All rights reserved.", "Todos os direitos reservados.")}</p>
          <p>
            {t(
              "Product images show illustrative sample data. Photography via Unsplash.",
              "As imagens do produto mostram dados ilustrativos de exemplo. Fotos via Unsplash.",
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
