import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";

import { BrandMark } from "@/components/app/brand-mark";
import {
  FALLBACK_BRAND,
  generateTheme,
  themeToCssVars,
  type BrandColors,
} from "@/lib/theme-engine";
import {
  LANGUAGES,
  applyClientLanguageAfterHydration,
  setLanguage,
  type LanguageCode,
} from "@/lib/i18n";
import { auth, SOCIAL_PROVIDERS, type SocialProvider, AuthError } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AuthBackButton } from "@/components/auth/back-button";

/** Applies the platform (or invited tenant) theme on auth screens. */
function useAuthTheme(brand: BrandColors) {
  useEffect(() => {
    applyClientLanguageAfterHydration();
    const mode = localStorage.getItem("servora.mode") === "dark" ? "dark" : "light";
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    Object.entries(themeToCssVars(generateTheme(brand, mode))).forEach(([k, v]) =>
      root.style.setProperty(k, v),
    );
  }, [brand.primary, brand.accent]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AuthLayout({
  children,
  brand = FALLBACK_BRAND,
  orgName,
  back = "/auth",
}: {
  children: ReactNode;
  brand?: BrandColors;
  orgName?: string;
  /** Safe fallback when there is no previous auth step; null hides when none. */ back?:
    string | null;
}) {
  const { t, i18n } = useTranslation("auth");
  useAuthTheme(brand);
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between">
          <Link to="/auth" className="inline-flex items-center gap-2.5">
            <BrandMark className="size-7 text-foreground" />
            <span className="text-[15px] font-semibold tracking-tight">{t("brand.product")}</span>
          </Link>
          <div
            role="group"
            aria-label={t("language")}
            className="inline-flex rounded-md border p-0.5 text-xs"
          >
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code as LanguageCode)}
                aria-pressed={i18n.language === l.code}
                className={cn(
                  "rounded px-2 py-1 font-medium transition-colors",
                  i18n.language === l.code
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.short}
              </button>
            ))}
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <AuthBackButton fallback={back} />
            {children}
          </div>
        </main>
        <p className="text-center text-xs text-muted-foreground lg:text-left">© 2026 Dinequora</p>
      </div>

      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="absolute inset-0 opacity-[0.5] [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px]"
          aria-hidden
        />
        <div className="relative">
          <p className="eyebrow">{orgName ?? t("brand.tagline")}</p>
        </div>
        <div className="relative max-w-md">
          <p className="text-[2rem] font-semibold leading-[1.15] tracking-tight text-balance">
            {t("brand.statement")}
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-sm text-muted-foreground">
            {(["point1", "point2", "point3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span className="inline-flex size-5 items-center justify-center rounded-full border bg-card text-primary">
                  <Check className="size-3" />
                </span>
                {t(`brand.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">{t("brand.footer")}</p>
      </aside>
    </div>
  );
}

export function AuthHeading({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-7">
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  trailing,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cn(
          "h-10 rounded-md border bg-card px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70",
          "focus:border-ring focus:ring-3 focus:ring-ring/15",
          error && "border-destructive focus:border-destructive focus:ring-destructive/15",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function PasswordField(props: Omit<Parameters<typeof Field>[0], "type">) {
  const { t } = useTranslation("auth");
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t("fields.hide") : t("fields.show")}
        className="absolute right-1.5 top-[30px] inline-flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function SubmitButton({
  loading,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || props.disabled}
      className={cn(
        "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function FormAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2.5 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "success" && "border-success/30 bg-success/5 text-foreground",
        tone === "info" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.2 3.3v2.75h3.55c2.08-1.92 3.25-4.74 3.25-8.08Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.75c-.98.66-2.24 1.05-3.72 1.05-2.86 0-5.28-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.85 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.67-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15A10.96 10.96 0 0 0 2.18 7.05l3.67 2.84C6.72 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function SocialButtons({ onError }: { onError: (code: string) => void }) {
  const { t } = useTranslation("auth");
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const go = async (p: SocialProvider) => {
    setBusy(p);
    try {
      await auth.signInWithProvider(p);
    } catch (e) {
      onError(e instanceof AuthError ? e.code : "unknown");
    } finally {
      setBusy(null);
    }
  };
  const providers = SOCIAL_PROVIDERS.filter((p) => p.enabled);
  if (!providers.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {providers.map(({ id }) => (
        <button
          key={id}
          type="button"
          onClick={() => go(id)}
          disabled={busy !== null}
          className="inline-flex h-10 items-center justify-center gap-2.5 rounded-md border bg-card text-sm font-medium shadow-xs transition-colors hover:bg-muted disabled:opacity-60"
        >
          {busy === id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : id === "google" ? (
            <GoogleIcon />
          ) : (
            <MicrosoftIcon />
          )}
          {t(`social.${id}`)}
        </button>
      ))}
      <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("social.or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
