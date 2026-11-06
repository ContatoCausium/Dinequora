import { useEffect, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

const KEY = "servora.authTrail";
const AUTH_PATHS = ["/auth", "/signup", "/forgot-password", "/reset-password", "/invite/"];

/** True only for public authentication steps — never protected pages. */
export function isAuthStep(href: string | null | undefined): boolean {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/)[0] ?? "";
  return AUTH_PATHS.some((p) =>
    p.endsWith("/") ? path.startsWith(p) && path.length > p.length : path === p,
  );
}

type Entry = { idx: number; href: string };
const histIdx = () => (window.history.state as { __TSR_index?: number } | null)?.__TSR_index ?? -1;
const read = (): Entry[] => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * Back arrow for auth screens. Uses real browser history when the previous
 * entry is a known auth step (so the browser back button stays consistent and
 * tokens/search are preserved); otherwise replaces to a safe auth fallback.
 */
export function AuthBackButton({ fallback }: { fallback: string | null }) {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const navigate = useNavigate();
  const [prev, setPrev] = useState<string | null>(null);

  useEffect(() => {
    const idx = histIdx();
    const href = window.location.pathname + window.location.search;
    const trail = read()
      .filter((e) => e.idx < idx)
      .slice(-20);
    const before = trail.find((e) => e.idx === idx - 1);
    setPrev(before && isAuthStep(before.href) && before.href !== href ? before.href : null);
    sessionStorage.setItem(KEY, JSON.stringify([...trail, { idx, href }]));
  }, [router.state.location.href]);

  const safeFallback = isAuthStep(fallback) ? fallback : null;
  if (!prev && !safeFallback) return null;

  const go = () => {
    if (prev) router.history.back();
    else if (safeFallback) void navigate({ href: safeFallback, replace: true });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={go}
      aria-label={t("nav.back")}
      title={t("nav.back")}
      className="-ml-2.5 mb-6 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 active:scale-95 sm:size-9 [&:hover>svg]:-translate-x-0.5"
    >
      <ArrowLeft
        className="size-[18px] transition-transform duration-200"
        strokeWidth={1.75}
        aria-hidden
      />
    </Button>
  );
}
