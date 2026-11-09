import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  Command as CommandIcon,
  Globe,
  Lock,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Store,
  Sun,
  MoreHorizontal,
  Gauge,
  MapPinned,
  SwatchBook,
  Activity,
  ReceiptText,
  MonitorSmartphone,
  CookingPot,
  BookOpenText,
  Boxes,
  UsersRound,
  Landmark,
  ChartNoAxesCombined,
  FileBarChart,
  ServerCog,
  CreditCard,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { auth } from "@/lib/auth";

import { cn } from "@/lib/utils";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { chooseLanguage } from "@/lib/profile-service";
import { operationalAlerts } from "@/lib/demo-data";
import { useWorkspace } from "./workspace-context";
import { DemoBadge, OrgLogo, ServoraMark } from "./brand-mark";
import { EmptyState, SuspendedState } from "./states";
import { OnboardingProgress } from "./onboarding-progress";
import { storeConfigured } from "@/lib/onboarding-checklist";
import { requiredFor } from "@/lib/route-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavTo =
  | "/"
  | "/pos"
  | "/orders"
  | "/kds"
  | "/menu"
  | "/inventory"
  | "/finance"
  | "/reports"
  | "/intelligence"
  | "/locations"
  | "/team"
  | "/settings/branding"
  | "/settings/billing";
type NavItem = { to: NavTo; key: string; icon: typeof Store };
// Curated icon set: one stroke weight, restaurant-operations semantics. Grouped by intent.
const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  {
    key: "groupOperations",
    items: [
      { to: "/", key: "overview", icon: Gauge },
      { to: "/pos", key: "pos", icon: MonitorSmartphone },
      { to: "/orders", key: "orders", icon: ReceiptText },
      { to: "/kds", key: "kds", icon: CookingPot },
      { to: "/menu", key: "menu", icon: BookOpenText },
      { to: "/inventory", key: "inventory", icon: Boxes },
    ],
  },
  {
    key: "groupManagement",
    items: [
      { to: "/finance", key: "finance", icon: Landmark },
      { to: "/reports", key: "reports", icon: FileBarChart },
      { to: "/intelligence", key: "intelligence", icon: ChartNoAxesCombined },
      { to: "/locations", key: "locations", icon: MapPinned },
      { to: "/team", key: "employees", icon: UsersRound },
    ],
  },
  {
    key: "groupAccount",
    items: [
      { to: "/settings/branding", key: "branding", icon: SwatchBook },
      { to: "/settings/billing", key: "billing", icon: CreditCard },
    ],
  },
];
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const UPCOMING: { key: string; icon: typeof Store }[] = [{ key: "liveOps", icon: Activity }];

function useActive() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
}

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const isActive = useActive();
  const { isPlatformAdmin, canAny } = useWorkspace();
  const visible = (to: string) => {
    const req = requiredFor(to);
    return !req || canAny(req);
  };
  return (
    <nav
      className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
      aria-label={t("a11y.mainNav")}
    >
      {NAV_GROUPS.filter((group) => group.items.some((item) => visible(item.to))).map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          {!collapsed && <p className="eyebrow px-2 pb-1.5">{t(`nav.${group.key}`)}</p>}
          {group.items
            .filter((item) => visible(item.to))
            .map(({ to, key, icon: Icon }) => {
              const active = isActive(to);
              const link = (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center transition-colors",
                      active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[15px]" strokeWidth={1.75} />
                  </span>
                  {!collapsed && <span className="truncate">{t(`nav.${key}`)}</span>}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{t(`nav.${key}`)}</TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        {!collapsed && <p className="eyebrow px-2 pb-1.5">{t("nav.comingNext")}</p>}
        {UPCOMING.map(({ key, icon: Icon }) => (
          <div
            key={key}
            aria-disabled
            title={t("nav.notYetAvailable")}
            className={cn(
              "flex h-8 cursor-not-allowed items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground/75",
              collapsed && "justify-center px-0",
            )}
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center">
              <Icon className="size-[15px] opacity-70" strokeWidth={1.75} />
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{t(`nav.${key}`)}</span>
                <Lock className="size-3 opacity-50" />
              </>
            )}
          </div>
        ))}
      </div>
      {isPlatformAdmin && (
        <div className="mt-auto flex flex-col gap-0.5 border-t pt-4">
          {!collapsed && <p className="eyebrow px-2 pb-1.5">{t("nav.platform")}</p>}
          <Link
            to="/control"
            onClick={onNavigate}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <span className="inline-flex size-6 items-center justify-center text-muted-foreground">
              <ServerCog className="size-[15px]" strokeWidth={1.75} />
            </span>
            {!collapsed && <span className="truncate">{t("nav.controlCenter")}</span>}
          </Link>
        </div>
      )}
    </nav>
  );
}

function OrgSwitcher({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { org, orgs, setOrgId, brand } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent/60",
          compact && "w-auto",
        )}
        aria-label={t("shell.switchOrg")}
      >
        <OrgLogo logoUrl={brand.logoUrl} initials={org.initials} className="size-9" />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{org.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(`plans.${org.plan}`)} ·{" "}
                {t("shell.locationCount", { count: org.locations.length })}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="eyebrow">{t("shell.organizations")}</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => setOrgId(o.id)} className="gap-2.5">
            <OrgLogo logoUrl={o.logoUrl} initials={o.initials} className="size-7" />
            <span className="flex-1 truncate">{o.name}</span>
            {o.fictional && (
              <span className="text-[10px] text-muted-foreground">{t("demo.fictional")}</span>
            )}
            {o.id === org.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LocationSelector({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { org, locationId, setLocationId } = useWorkspace();
  const current = org.locations.find((l) => l.id === locationId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-9 min-w-0 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium shadow-xs transition-colors hover:bg-muted",
          className,
        )}
        aria-label={t("shell.selectLocation")}
      >
        <Store className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="truncate">{current ? current.name : t("shell.allLocations")}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onClick={() => setLocationId("all")} className="gap-2.5 py-2">
          <Building2 className="size-4" />
          <span className="flex-1">
            <span className="block font-medium">{t("shell.allLocations")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("shell.consolidatedView")}
            </span>
          </span>
          {locationId === "all" && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {org.locations.map((l) => (
          <DropdownMenuItem key={l.id} onClick={() => setLocationId(l.id)} className="gap-2.5 py-2">
            <Store className="size-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {/* "Setup required" only when the store really lacks address or opening hours. */}
                {l.status === "verified" || storeConfigured(l)
                  ? l.address
                  : t("shell.configRequired")}
              </span>
            </span>
            {l.id === locationId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Notifications() {
  const { t } = useTranslation();
  const { org } = useWorkspace();
  // The sample alerts are synthetic: only demo organizations (organizations.is_demo) get them.
  const alerts = org.fictional ? operationalAlerts(org.locations) : [];
  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("shell.notifications")}
      >
        <Bell className="size-4" strokeWidth={1.75} />
        {alerts.length > 0 && (
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary ring-2 ring-background" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{t("shell.notifications")}</p>
          {org.fictional && <DemoBadge label={t("demo.badge")} />}
        </div>
        {alerts.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t("shell.notificationsEmpty")}
          </p>
        )}
        <ul className="max-h-80 divide-y overflow-y-auto">
          {alerts.map((a) => (
            <li key={a.id} className="flex gap-3 px-4 py-3">
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  a.severity === "high"
                    ? "bg-destructive"
                    : a.severity === "medium"
                      ? "bg-warning"
                      : "bg-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm">
                  {t(`dashboard:alerts.${a.kind}.title`, { count: a.count })}
                </p>
                <p className="truncate text-xs text-muted-foreground">{a.location.name}</p>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PreferencesMenu() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, user, role, isPlatformAdmin } = useWorkspace();
  const navigate = useNavigate();
  const name = user.fullName || user.email;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const signOut = async () => {
    await auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 inline-flex size-8 items-center justify-center rounded-full border bg-card text-[11px] font-semibold tracking-wide text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
        aria-label={t("shell.account")}
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">
            {user.email} · {t(`auth:roles.${role}`)}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isPlatformAdmin && (
          <DropdownMenuItem asChild className="gap-2">
            <Link to="/control">
              <ServerCog className="size-4" />
              {t("nav.controlCenter")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Globe className="size-4" />
            {t("shell.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LANGUAGES.map((l) => (
              <DropdownMenuItem
                key={l.code}
                onClick={() => void chooseLanguage(user.id, l.code as LanguageCode)}
                className="gap-2"
              >
                <span className="w-6 text-xs text-muted-foreground">{l.short}</span>
                <span className="flex-1">{l.label}</span>
                {i18n.language === l.code && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
          className="gap-2"
        >
          {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {mode === "dark" ? t("shell.lightMode") : t("shell.darkMode")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="gap-2">
          <LogOut className="size-4" />
          {t("shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageQuick() {
  const { i18n, t } = useTranslation();
  const { user } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
        aria-label={t("shell.language")}
      >
        <Globe className="size-4" strokeWidth={1.75} />
        {LANGUAGES.find((l) => l.code === i18n.language)?.short ?? "EN"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => void chooseLanguage(user.id, l.code as LanguageCode)}
            className="gap-2"
          >
            <span className="flex-1">{l.label}</span>
            {i18n.language === l.code && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const { org, setLocationId, canAny } = useWorkspace();
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("shell.searchPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("shell.noResults")}</CommandEmpty>
        <CommandGroup heading={t("nav.workspace")}>
          {NAV.filter((n) => {
            const req = requiredFor(n.to);
            return !req || canAny(req);
          }).map((n) => (
            <CommandItem key={n.to} asChild onSelect={() => setOpen(false)}>
              <Link to={n.to} onClick={() => setOpen(false)}>
                <n.icon className="size-4" />
                {t(`nav.${n.key}`)}
              </Link>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("nav.locations")}>
          {org.locations.map((l) => (
            <CommandItem
              key={l.id}
              onSelect={() => {
                setLocationId(l.id);
                setOpen(false);
              }}
            >
              <Store className="size-4" />
              {l.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { orgStatus, suspendedReason, org } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const isActive = useActive();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          {t("a11y.skipToContent")}
        </a>
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          <div
            className={cn("flex h-16 items-center border-b px-3", collapsed && "justify-center")}
          >
            <OrgSwitcher compact={collapsed} />
          </div>
          <SidebarNav collapsed={collapsed} />
          <div className={cn("flex items-center gap-2 border-t p-3", collapsed && "flex-col")}>
            <ServoraMark className="size-6 text-foreground" />
            {!collapsed && (
              <span className="flex-1 text-xs text-muted-foreground">{t("shell.poweredBy")}</span>
            )}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60"
              aria-label={collapsed ? t("a11y.expandSidebar") : t("a11y.collapseSidebar")}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted lg:hidden"
              aria-label={t("a11y.openMenu")}
            >
              <Menu className="size-5" strokeWidth={1.75} />
            </button>
            <LocationSelector className="max-w-[220px] sm:max-w-xs" />
            <button
              onClick={() => setCmdOpen(true)}
              className="ml-2 hidden h-9 w-64 items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:bg-muted md:inline-flex"
            >
              <Search className="size-4" strokeWidth={1.75} />
              <span className="flex-1 text-left">{t("shell.search")}</span>
              <kbd className="inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px]">
                <CommandIcon className="size-2.5" />K
              </kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setCmdOpen(true)}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"
                aria-label={t("shell.search")}
              >
                <Search className="size-4" strokeWidth={1.75} />
              </button>
              <LanguageQuick />
              <Notifications />
              <PreferencesMenu />
            </div>
          </header>

          <main
            id="main"
            className="min-w-0 flex-1 overflow-x-clip px-4 pb-28 pt-6 md:px-6 lg:px-8 lg:pb-12"
          >
            {orgStatus === "suspended" ? (
              <SuspendedState reason={suspendedReason} />
            ) : (
              <>
                <OnboardingProgress />
                {children}
              </>
            )}
          </main>
        </div>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">{t("a11y.mainNav")}</SheetTitle>
            <div className="border-b p-3 pr-10">
              <OrgSwitcher />
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          aria-label={t("a11y.mobileNav")}
        >
          {NAV.slice(0, 3).map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                isActive(to) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              {t(`nav.${key}`)}
            </Link>
          ))}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="size-5" strokeWidth={1.75} />
            {t("nav.more")}
          </button>
        </nav>

        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
      </div>
    </TooltipProvider>
  );
}
