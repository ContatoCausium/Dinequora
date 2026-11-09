import { useEffect, useState } from "react";
import { whatsappGreeting, whatsappUrl } from "../config/site";
import { useLocale, useT } from "../i18n/locale";
import { cx } from "./ui";

/** WhatsApp glyph (Simple Icons, CC0). Decorative: label the link that contains it. */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * Floating "talk to sales" button. Appears after the hero and steps aside
 * while the contact section (which has its own WhatsApp card) is on screen.
 */
export function WhatsAppFloat() {
  const { locale } = useLocale();
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const h = window.innerHeight;
      const pastHero = window.scrollY > h * 0.6;
      // Hidden while the contact section crosses the middle of the screen (works for tall sections too).
      const contact = document.getElementById("demo")?.getBoundingClientRect();
      const overContact = contact ? contact.top < h * 0.6 && contact.bottom > h * 0.4 : false;
      setVisible(pastHero && !overContact);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const label = t("Talk to sales", "Fale com o comercial");

  return (
    <a
      href={whatsappUrl(whatsappGreeting[locale])}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("Talk to sales on WhatsApp (opens in a new tab)", "Fale com o comercial no WhatsApp (abre em nova aba)")}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cx(
        "wa-float group fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-full bg-emerald p-1.5 pr-1.5 text-navy",
        "shadow-[0_18px_50px_-12px_rgb(16_185_129/0.65),0_0_0_1px_rgb(255_255_255/0.08)_inset] transition-all duration-500 sm:right-6 sm:bottom-6 sm:pr-5",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
      )}
    >
      <span className="relative grid size-12 place-items-center rounded-full bg-navy text-emerald">
        <span aria-hidden className="wa-ping absolute inset-0 rounded-full ring-2 ring-emerald/60" />
        <WhatsAppIcon className="size-6" />
      </span>
      <span className="hidden text-[0.92rem] leading-tight font-semibold sm:block">
        {label}
        <span className="block text-[0.72rem] font-medium text-navy/70">WhatsApp</span>
      </span>
    </a>
  );
}
