import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { FeatureStatus } from "../content/features";
import { statusLabels } from "../content/features";
import { LOCALES, localeName, pick, useLocale } from "../i18n/locale";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- Logo */

type LogoVariant = "full-dark" | "full-light" | "icon";

const logoSrc: Record<LogoVariant, { src: string; w: number; h: number }> = {
  // Official files from the Dinequora SVG Brand Kit — used unmodified.
  "full-dark": { src: "/brand/dinequora_completa_escuro.svg", w: 830, h: 220 },
  "full-light": { src: "/brand/dinequora_completa_claro.svg", w: 830, h: 220 },
  icon: { src: "/brand/dinequora_icone_transparente.svg", w: 200, h: 200 },
};

export function Logo({ variant, className }: { variant: LogoVariant; className?: string }) {
  const { src, w, h } = logoSrc[variant];
  const { locale } = useLocale();
  return (
    <img
      src={src}
      width={w}
      height={h}
      alt={pick(locale, "Dinequora — Restaurant Intelligence Platform", "Dinequora — Plataforma de Inteligência para Restaurantes")}
      className={cx("block select-none", className)}
      draggable={false}
    />
  );
}

/* ------------------------------------------------------------- Buttons */

type ButtonTone = "primary" | "ghost" | "quiet" | "light";

const toneClass: Record<ButtonTone, string> = {
  primary:
    "bg-emerald text-navy hover:bg-emerald-soft shadow-[0_0_0_1px_rgb(16_185_129/0.4),0_10px_30px_-10px_rgb(16_185_129/0.6)]",
  ghost: "text-offwhite ring-1 ring-inset ring-mist/25 hover:ring-mist/50 hover:bg-white/[0.04]",
  quiet: "text-mist hover:text-offwhite",
  light: "bg-navy text-offwhite hover:bg-navy-800",
};

type ButtonLinkProps = {
  href: string;
  tone?: ButtonTone;
  size?: "md" | "lg";
  arrow?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"a">, "href" | "className" | "children">;

export function ButtonLink({ href, tone = "primary", size = "md", arrow, children, className, ...rest }: ButtonLinkProps) {
  return (
    <a
      href={href}
      className={cx(
        "group inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all duration-300",
        size === "lg" ? "h-12 px-6 text-[0.95rem]" : "h-10 px-4.5 text-sm",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {children}
      {arrow && (
        <ArrowRight aria-hidden className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
      )}
    </a>
  );
}

/* ------------------------------------------------------------- Reveal */

export function useInView<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  // Without IntersectionObserver (old browsers, tests) content is shown immediately.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12, ...options },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [options]);
  return { ref, inView };
}

type RevealProps<T extends ElementType> = {
  as?: T;
  delay?: number;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function Reveal<T extends ElementType = "div">({ as, delay = 0, className, children, ...rest }: RevealProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  const { ref, inView } = useInView<HTMLElement>();
  return (
    <Tag
      ref={ref}
      className={cx("reveal", inView && "is-visible", className)}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------ Section header */

export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = "left",
  tone = "dark",
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  tone?: "dark" | "light";
  id?: string;
}) {
  const dark = tone === "dark";
  return (
    <Reveal className={cx("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <p className={cx("eyebrow", dark ? "text-emerald" : "text-emerald-ink")}>
        <span aria-hidden className={cx("h-px w-6", dark ? "bg-emerald/70" : "bg-emerald-ink/60")} />
        {eyebrow}
      </p>
      <h2
        id={id}
        className={cx(
          "heading mt-5 text-[2.1rem] sm:text-5xl lg:text-[3.4rem]",
          dark ? "text-offwhite" : "text-ink",
        )}
      >
        {title}
      </h2>
      {lead && (
        <p className={cx("mt-5 text-base leading-relaxed sm:text-lg", dark ? "text-mist" : "text-slate")}>{lead}</p>
      )}
    </Reveal>
  );
}

/* ------------------------------------------------------- Status badge */

export function StatusBadge({ status, tone = "dark" }: { status: FeatureStatus; tone?: "dark" | "light" }) {
  const statusLabel = statusLabels[useLocale().locale];
  if (status === "available") {
    return (
      <span
        className={cx(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tracking-wide",
          tone === "dark" ? "bg-emerald/10 text-emerald ring-1 ring-emerald/25" : "bg-emerald/10 text-emerald-ink ring-1 ring-emerald/30",
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-emerald" />
        {statusLabel.available}
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tracking-wide",
        tone === "dark" ? "bg-amber/10 text-amber ring-1 ring-amber/25" : "bg-amber/10 text-[#92400e] ring-1 ring-amber/40",
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full border border-current" />
      {statusLabel.rollingOut}
    </span>
  );
}

/* ---------------------------------------------------- Language switch */

export function LanguageSwitcher({ className, size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const { locale, setLocale } = useLocale();
  return (
    <div
      role="group"
      aria-label={pick(locale, "Language", "Idioma")}
      className={cx("inline-flex items-center rounded-full p-0.5 ring-1 ring-inset ring-mist/20", className)}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l === "pt" ? "pt-BR" : "en-US"}
          aria-pressed={l === locale}
          title={localeName[l]}
          onClick={() => setLocale(l)}
          className={cx(
            "rounded-full font-semibold tracking-wide uppercase transition-colors duration-300",
            size === "lg" ? "px-4 py-2 text-sm" : "px-2.5 py-1 text-[0.72rem]",
            l === locale ? "bg-offwhite text-navy" : "text-mist hover:text-offwhite",
          )}
        >
          <span aria-hidden>{l}</span>
          <span className="sr-only">{localeName[l]}</span>
        </button>
      ))}
    </div>
  );
}
