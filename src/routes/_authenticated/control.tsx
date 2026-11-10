import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bell,
  Building2,
  CreditCard,
  DollarSign,
  FlaskConical,
  Headphones,
  History,
  LayoutGrid,
  LogOut,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { BrandMark } from "@/components/app/brand-mark";
import { AppError, AppPending } from "@/components/app/states";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { isPlatformAdmin } from "@/lib/admin-service";
import { auth } from "@/lib/auth";
import { fetchMemberships } from "@/lib/org-service";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { applyUserLanguage, chooseLanguage } from "@/lib/profile-service";
import { generateTheme, themeToCssVars } from "@/lib/theme-engine";
import { cn } from "@/lib/utils";

/** Platform palette: graphite + brass, deliberately unlike any restaurant workspace. */
const PLATFORM_BRAND = { primary: "#2e3a4b", accent: "#a8875a" };

export const Route = createFileRoute("/_authenticated/control")({
  head: () => ({
    meta: [
      { title: "Control Center · Dinequora" },
      {
        name: "description",
        content:
          "Dinequora platform administration: organizations, plans, demo studio, audit log and settings.",
      },
      { property: "og:title", content: "Control Center · Dinequora" },
      {
        property: "og:description",
        content:
          "Dinequora platform administration: organizations, plans, demo studio, audit log and settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // UI gate only; every data call is re-authorized in the database.
  beforeLoad: async () => {
    if (!(await isPlatformAdmin())) {
      toast.error(i18n.t("common:states.controlDenied"));
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ context }) => ({
    hasWorkspace: (await fetchMemberships(context.user.id)).length > 0,
  }),
  pendingComponent: AppPending,
  errorComponent: AppError,
  component: ControlLayout,
});

/** Modules not built yet: shown disabled as "Coming next", never as links. */
const COMING_NEXT = [
  { key: "support", icon: Headphones },
  { key: "notifications", icon: Bell },
] as const;

const NAV = [
  { to: "/control", key: "overview", icon: LayoutGrid, exact: true },
  { to: "/control/organizations", key: "orgs", icon: Building2 },
  { to: "/control/subscriptions", key: "subscriptions", icon: DollarSign },
  { to: "/control/plans", key: "plans", icon: CreditCard },
  { to: "/control/demo", key: "demo", icon: FlaskConical },
  { to: "/control/audit", key: "audit", icon: History },
  { to: "/control/admins", key: "admins", icon: ShieldCheck },
  { to: "/control/settings", key: "settings", icon: Settings2 },
] as const;

function ControlLayout() {
  const { t, i18n } = useTranslation("control");
  const { user } = Route.useRouteContext();
  const { hasWorkspace } = Route.useLoaderData();
  const navigate = useNavigate();

  useEffect(() => {
    void applyUserLanguage(user.id).catch(() => {});
    const root = document.documentElement;
    const vars = themeToCssVars(
      generateTheme(PLATFORM_BRAND, root.classList.contains("dark") ? "dark" : "light"),
    );
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [user.id]);

  const signOut = async () => {
    await auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 min-w-0 border-b bg-sidebar md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-14 items-center gap-2.5 px-4 md:h-16 md:px-5">
          <BrandMark className="size-6 text-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Dinequora</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t("badge")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <LangToggle userId={user.id} lng={i18n.language} />
          </div>
        </div>
        <nav
          aria-label={t("title")}
          className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0"
        >
          {NAV.map(({ to, key, icon: Icon, ...rest }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: "exact" in rest }}
              className="group inline-flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[status=active]:bg-card data-[status=active]:text-foreground data-[status=active]:shadow-xs md:h-9"
            >
              <Icon
                className="size-4 text-muted-foreground group-data-[status=active]:text-primary"
                strokeWidth={1.75}
              />
              {t(`nav.${key}`)}
            </Link>
          ))}
          {COMING_NEXT.map(({ key, icon: Icon }) => (
            <span
              key={key}
              aria-disabled="true"
              title={t("nav.comingNext", { ns: "common" })}
              className="inline-flex h-10 shrink-0 cursor-not-allowed items-center gap-2.5 rounded-md px-3 text-sm font-medium text-muted-foreground opacity-60 md:h-9"
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {t(`nav.${key}`)}
              <span className="ml-auto text-[10px] uppercase tracking-wide">
                {t("nav.comingNext", { ns: "common" })}
              </span>
            </span>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 hidden flex-col gap-2 border-t p-3 md:flex">
          <LangToggle userId={user.id} lng={i18n.language} />
          <p className="truncate px-1 text-xs text-muted-foreground" title={user.email ?? ""}>
            {user.email}
          </p>
          {hasWorkspace && (
            <Link
              to="/"
              className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {t("back")}
            </Link>
          )}
          <button
            onClick={signOut}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            {t("signOut")}
          </button>
        </div>
      </aside>
      <main className="mx-auto min-w-0 w-full max-w-[1200px] px-4 py-6 md:px-8 md:py-8">
        <Outlet />
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t pt-4 text-xs text-muted-foreground md:hidden">
          {hasWorkspace && (
            <Link to="/" className="font-medium hover:text-foreground">
              {t("back")}
            </Link>
          )}
          <button onClick={signOut} className="font-medium hover:text-foreground">
            {t("signOut")}
          </button>
          <span className="ml-auto truncate">{user.email}</span>
        </div>
      </main>
    </div>
  );
}

function LangToggle({ userId, lng }: { userId: string; lng: string }) {
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex rounded-md border bg-card p-0.5 text-xs"
    >
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          onClick={() => void chooseLanguage(userId, l.code as LanguageCode)}
          aria-pressed={lng === l.code}
          className={cn(
            "min-w-9 rounded px-2 py-1 font-medium",
            lng === l.code
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
