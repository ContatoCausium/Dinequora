import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Menu, X } from "lucide-react";
import { appRoutes, DEMO_ANCHOR, getPrimaryNav, WHATSAPP, whatsappGreeting, whatsappUrl } from "../config/site";
import { ButtonLink, cx, LanguageSwitcher, Logo } from "../components/ui";
import { UnavailableAction, useComingSoonLabels } from "../components/appAccess";
import { WhatsAppIcon } from "../components/whatsapp";
import { pick, useLocale } from "../i18n/locale";

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const primaryNav = getPrimaryNav(locale);
  const progress = useRef<HTMLDivElement>(null);
  const waHref = whatsappUrl(whatsappGreeting[locale]);
  const soon = useComingSoonLabels();

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      // Reading-progress hairline under the header (written directly, no re-render per frame).
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progress.current) progress.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /**
   * In-page links inside the mobile menu: close the menu (which releases the
   * scroll lock) first, then scroll to the target on the next frame.
   */
  const goTo = (e: MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute("href") ?? "";
    setOpen(false);
    if (!href.startsWith("#")) return;
    e.preventDefault();
    document.body.style.overflow = "";
    requestAnimationFrame(() => {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
      history.pushState(null, "", href);
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 bg-navy transition-[border-color,box-shadow] duration-500",
        "border-b",
        scrolled ? "border-line-dark shadow-[0_12px_40px_-20px_rgb(0_0_0/0.8)]" : "border-transparent",
      )}
    >
      <div className="container-page flex h-[68px] items-center justify-between gap-6">
        <a href="#top" className="-ml-1 shrink-0 rounded-md" aria-label={t("Dinequora home", "Dinequora, início")}>
          {/* Official dark-background lockup; header background matches its navy exactly. */}
          <Logo variant="full-dark" className="h-[44px] w-auto" />
        </a>

        <nav aria-label={t("Primary", "Principal")} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-2.5 py-2 text-[0.9rem] xl:px-3.5 font-medium text-mist transition-colors hover:text-offwhite"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitcher className="mr-1" />
          {appRoutes ? (
            <a
              href={appRoutes.login}
              className="rounded-full px-2.5 py-2 text-[0.9rem] xl:px-3.5 font-medium text-mist transition-colors hover:text-offwhite"
            >
              {t("Login", "Entrar")}
            </a>
          ) : (
            // The app is not published yet: "Coming soon" takes the Login slot, with no link.
            <UnavailableAction
              label={soon.soon}
              accessibleName={soon.loginSoon}
              badge={false}
              className="inline-flex h-9 rounded-full px-3 text-[0.85rem] font-medium whitespace-nowrap text-mist/80 ring-1 ring-inset ring-mist/20"
            />
          )}
          {/* WhatsApp pill only where there is room (≥1280px); the floating button covers smaller screens. */}
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("Talk to sales on WhatsApp (opens in a new tab)", "Fale com o comercial no WhatsApp (abre em nova aba)")}
            className="hidden h-10 items-center gap-2 rounded-full px-3.5 text-[0.9rem] font-medium text-offwhite ring-1 ring-inset ring-emerald/35 transition-colors hover:bg-emerald/10 hover:ring-emerald/60 xl:inline-flex"
          >
            <WhatsAppIcon className="size-4 text-emerald" />
            WhatsApp
          </a>
          {/* Short label so the header fits on 1024px screens in both languages. */}
          <ButtonLink href={DEMO_ANCHOR}>{t("Book a Demo", "Agendar demo")}</ButtonLink>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <LanguageSwitcher />
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full text-offwhite ring-1 ring-mist/20"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? t("Close menu", "Fechar menu") : t("Open menu", "Abrir menu")}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <div aria-hidden className="absolute inset-x-0 -bottom-px h-px overflow-hidden">
        <div
          ref={progress}
          className="h-full origin-left bg-gradient-to-r from-emerald/0 via-emerald to-emerald-soft"
          style={{ transform: "scaleX(0)" }}
        />
      </div>

      <div
        id="mobile-menu"
        hidden={!open}
        className="h-[calc(100dvh-68px)] overflow-y-auto border-t border-line-dark bg-navy lg:hidden"
      >
        <nav aria-label={t("Mobile", "Menu móvel")} className="container-page py-6">
          <ul className="divide-y divide-line-dark">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={goTo}
                  className="flex items-center justify-between py-4 text-xl font-medium tracking-tight text-offwhite"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              {appRoutes ? (
                <a href={appRoutes.login} className="flex py-4 text-xl font-medium tracking-tight text-mist">
                  {t("Login", "Entrar")}
                </a>
              ) : (
                <UnavailableAction
                  label={t("Login", "Entrar")}
                  accessibleName={soon.loginSoon}
                  className="flex w-full justify-between py-4 text-xl font-medium tracking-tight text-mist/60"
                />
              )}
            </li>
          </ul>
          <ButtonLink href={DEMO_ANCHOR} size="lg" arrow className="mt-8 w-full" onClick={goTo}>
            {t("Book a Demo", "Agendar demonstração")}
          </ButtonLink>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-full font-semibold text-offwhite ring-1 ring-inset ring-emerald/40"
          >
            <WhatsAppIcon className="size-5 text-emerald" />
            {t("Talk to sales on WhatsApp", "Fale com o comercial no WhatsApp")}
          </a>
          <p className="mt-3 text-center text-sm text-mist">{WHATSAPP.display}</p>
        </nav>
      </div>
    </header>
  );
}
