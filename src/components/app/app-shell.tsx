import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Armchair,
  BookOpenText,
  Boxes,
  UsersRound,
  Landmark,
  ChartNoAxesCombined,
  FileBarChart,
  ServerCog,
  CreditCard,
  Clock3,
  TriangleAlert,
} from "lucide-react";
import { fmtNumber } from "@/lib/format";
import type { NavCountKey, NavCounts } from "@/lib/nav-counts";
import { useNavCounts } from "./use-nav-counts";
import { foldForSearch } from "@/lib/search-text";
import { useNavigate } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { clearTemporaryDeviceData, countHeldTicketsOnDevice } from "@/lib/session-cleanup";
import { stopPresentation } from "@/lib/presentation-mode";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { cn } from "@/lib/utils";
import {
  FocusModeContext,
  enterFullscreen,
  exitFullscreen,
  isOperationalRoute,
  type FocusMode,
} from "@/lib/focus-mode";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { chooseLanguage } from "@/lib/profile-service";
import { operationalAlerts } from "@/lib/demo-data";
import { useWorkspace } from "./workspace-context";
import { BrandMark, DemoBadge, OrgLogo } from "./brand-mark";
import { isClientPreview } from "@/lib/deployment-profile";
import { PresentationBanner, PresentationModeToggle } from "./presentation-mode";
import { usePresentationMode } from "./use-presentation-mode";
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
  | "/tables"
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
      { to: "/tables", key: "tables", icon: Armchair },
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

/** The counter each module shows in the navigation (redesign stage B). */
const COUNTER_FOR: Partial<Record<NavTo, NavCountKey>> = {
  "/orders": "openOrders",
  "/kds": "lateTickets",
  "/inventory": "lowStock",
};
/** Late tickets and low stock ask for attention; open orders are workload (neutral). */
const COUNTER_IS_ALERT: Record<NavCountKey, boolean> = {
  openOrders: false,
  lateTickets: true,
  lowStock: true,
};
const COUNTER_ICON: Partial<Record<NavCountKey, typeof Store>> = {
  lateTickets: Clock3,
  lowStock: TriangleAlert,
};

interface NavBadgeModel {
  key: NavCountKey;
  value: number;
  /** "99+" above 99; the exact number is always in `label`. */
  text: string;
  /** Spoken/tooltip text: "15 open orders". */
  label: string;
  alert: boolean;
}

/** Badge for a module, or null when there is nothing real to show (no permission, no data, 0). */
function useNavBadge(counts: NavCounts) {
  const { t, i18n } = useTranslation();
  return (to: NavTo): NavBadgeModel | null => {
    const key = COUNTER_FOR[to];
    if (!key) return null;
    const value = counts[key];
    if (value == null || value <= 0) return null;
    return {
      key,
      value,
      text: value > 99 ? "99+" : fmtNumber(value, i18n.language),
      label: t(`nav.counts.${key}`, { count: value, formatted: fmtNumber(value, i18n.language) }),
      alert: COUNTER_IS_ALERT[key],
    };
  };
}

/** Visible count pill (decorative: the link's accessible name carries the full sentence). */
function CountBadge({ badge, className }: { badge: NavBadgeModel; className?: string }) {
  const Icon = COUNTER_ICON[badge.key];
  return (
    <span
      aria-hidden
      data-nav-count={badge.key}
      className={cn(
        "tabular inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-full border bg-card px-1.5 text-[11px] font-semibold leading-none",
        badge.alert ? "border-warning/50 text-warning" : "border-border text-foreground",
        className,
      )}
    >
      {Icon && <Icon className="size-3" />}
      {badge.text}
    </span>
  );
}

/** Rail / bottom-bar marker: a dot on the icon (shape + position, not color alone). */
function CountDot({ badge, className }: { badge: NavBadgeModel; className?: string }) {
  return (
    <span
      aria-hidden
      data-nav-count={badge.key}
      className={cn(
        "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar",
        badge.alert ? "bg-warning" : "bg-muted-foreground",
        className,
      )}
    />
  );
}

function SidebarNav({
  collapsed,
  onNavigate,
  counts,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  counts: NavCounts;
}) {
  const { t } = useTranslation();
  const isActive = useActive();
  const { isPlatformAdmin, canAny } = useWorkspace();
  const badgeFor = useNavBadge(counts);
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
              const label = t(`nav.${key}`);
              const badge = badgeFor(to);
              const link = (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  // The rail shows only icons: the name (and the count) must still be announced.
                  aria-label={collapsed ? (badge ? `${label}, ${badge.label}` : label) : undefined}
                  className={cn(
                    "group relative flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium transition-colors",
                    active
                      ? "raised text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-secondary hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <span
                    className={cn(
                      "relative inline-flex size-6 shrink-0 items-center justify-center transition-colors",
                      active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {collapsed && badge && <CountDot badge={badge} />}
                  </span>
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                  {!collapsed && badge && (
                    <>
                      <CountBadge badge={badge} />
                      <span className="sr-only">, {badge.label}</span>
                    </>
                  )}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {badge ? `${label} · ${badge.label}` : label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
        </div>
      ))}
      {/* Roadmap items are not product: the client preview (shown to prospective customers) lists
          only what exists. */}
      {!isClientPreview() && (
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
                <Icon className="size-[18px] opacity-70" />
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
      )}
      {isPlatformAdmin && (
        <div className="mt-auto flex flex-col gap-0.5 border-t pt-4">
          {!collapsed && <p className="eyebrow px-2 pb-1.5">{t("nav.platform")}</p>}
          <Link
            to="/control"
            onClick={onNavigate}
            aria-label={collapsed ? t("nav.controlCenter") : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground/80 hover:bg-secondary hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <span className="inline-flex size-6 items-center justify-center text-muted-foreground">
              <ServerCog className="size-[18px]" />
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
          "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-secondary",
          compact && "w-auto",
        )}
        aria-label={t("shell.switchOrg")}
      >
        <OrgLogo logoUrl={brand.logoUrl} initials={org.initials} className="size-9" />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 break-words text-[13px] font-semibold leading-tight">
                {org.name}
              </span>
              <span className="sr-only">
                {t(`plans.${org.plan}`)} ·{" "}
                {t("shell.locationCount", { count: org.locations.length })}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 pb-1.5 pt-1">
          <p className="text-sm font-semibold">{org.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`plans.${org.plan}`)} · {t("shell.locationCount", { count: org.locations.length })}
          </p>
        </div>
        <DropdownMenuSeparator />
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
          "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium shadow-xs transition-colors hover:border-input sm:gap-2 sm:px-3",
          className,
        )}
        aria-label={t("shell.selectLocation")}
      >
        <Store className="size-4 shrink-0 text-muted-foreground max-sm:hidden" strokeWidth={1.75} />
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
                {/* "Setup required" only when the store really lacks address, opening hours or its sales-tax rate. */}
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

export function Notifications() {
  const { t } = useTranslation();
  const { org } = useWorkspace();
  // The sample alerts are synthetic: they exist only while presentation mode is explicitly on (demo
  // organizations only). By default no organization — demo or not — gets invented alerts.
  const { active: showcase } = usePresentationMode();
  const alerts = showcase ? operationalAlerts(org.locations) : [];
  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
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
          {showcase && <DemoBadge label={t("demo.badge")} />}
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
  // Held tickets exist only on this device; warn before discarding them on sign-out.
  const [heldOnDevice, setHeldOnDevice] = useState(0);
  const signOut = async () => {
    setHeldOnDevice(0);
    await auth.signOut();
    // Also cleared by the root sign-out listener; repeated here in case the event never arrives.
    clearTemporaryDeviceData();
    stopPresentation();
    await navigate({ to: "/auth", replace: true });
  };
  const requestSignOut = () => {
    const held = countHeldTicketsOnDevice();
    if (held > 0) setHeldOnDevice(held);
    else void signOut();
  };
  return (
    <>
      <AlertDialog open={heldOnDevice > 0} onOpenChange={(open) => !open && setHeldOnDevice(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("shell.signOutHeldTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("shell.signOutHeldBody", { count: heldOnDevice })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shell.signOutHeldCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void signOut()}>
              {t("shell.signOutHeldConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          <DropdownMenuItem onClick={requestSignOut} className="gap-2">
            <LogOut className="size-4" />
            {t("shell.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
            <CommandItem
              key={n.to}
              asChild
              keywords={[foldForSearch(t(`nav.${n.key}`))]}
              onSelect={() => setOpen(false)}
            >
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
              keywords={[foldForSearch(l.name)]}
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

/** Keyboard hint for the command palette: ⌘K on Apple platforms, Ctrl K elsewhere (after hydration). */
function ShortcutHint() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return (
    <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-b-2 bg-card px-1.5 font-sans text-[10.5px] font-medium text-muted-foreground">
      {mac ? <CommandIcon className="size-2.5" /> : "Ctrl"} K
    </kbd>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { orgStatus, suspendedReason, org, canAny } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const isActive = useActive();

  // Focus mode (POS, kitchen): the chrome steps aside; leaving the screen always restores it.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const operational = isOperationalRoute(path);
  const [focusOn, setFocusOn] = useState(false);
  const focusActive = operational && focusOn;
  // Sidebar counters (stage B): one query for the whole shell, paused while focus mode hides the
  // navigation (the POS and the kitchen board keep their own live data).
  const counts = useNavCounts(!focusActive);
  const badgeFor = useNavBadge(counts);
  // Phone bar: the first three modules this member may open (same rule as the sidebar and the
  // route guard), so it never offers a link the member cannot use.
  const barItems = NAV.filter((n) => {
    const req = requiredFor(n.to);
    return !req || canAny(req);
  }).slice(0, 3);
  // Counters whose module is not on the phone bar: flagged on "More" so they are never out of sight.
  const moreAlerts = (["/orders", "/kds", "/inventory"] as const)
    .filter((to) => !barItems.some((n) => n.to === to))
    .map((to) => badgeFor(to))
    .filter((b): b is NavBadgeModel => b !== null);
  // The dot takes the alert color when any of them asks for attention.
  const moreDot = moreAlerts.find((b) => b.alert) ?? moreAlerts[0];
  const wentFullscreen = useRef(false);
  const focus = useMemo<FocusMode>(() => {
    const exit = () => {
      setFocusOn(false);
      if (wentFullscreen.current) {
        wentFullscreen.current = false;
        void exitFullscreen();
      }
    };
    return {
      available: operational,
      active: focusActive,
      exit,
      toggle: () => {
        if (focusActive) return exit();
        setFocusOn(true);
        void enterFullscreen().then(() => {
          wentFullscreen.current = !!document.fullscreenElement;
        });
      },
    };
  }, [operational, focusActive]);
  useEffect(() => {
    if (!operational && focusOn) focus.exit();
  }, [operational, focusOn, focus]);
  useEffect(() => {
    // Leaving the browser's full screen (Esc, system gesture) also leaves focus mode.
    const onChange = () => {
      if (!document.fullscreenElement && wentFullscreen.current) {
        wentFullscreen.current = false;
        setFocusOn(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
    <FocusModeContext.Provider value={focus}>
      <TooltipProvider delayDuration={200}>
        <div className={cn("flex min-h-screen bg-background", operational && "touch-ui")}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          >
            {t("a11y.skipToContent")}
          </a>
          {/* Desktop sidebar */}
          {!focusActive && (
            <aside
              className={cn(
                "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
                collapsed ? "w-[68px]" : "w-64",
              )}
            >
              <div
                className={cn(
                  "flex h-14 items-center border-b px-3",
                  collapsed && "justify-center",
                )}
              >
                <OrgSwitcher compact={collapsed} />
              </div>
              <SidebarNav collapsed={collapsed} counts={counts} />
              <div className={cn("flex items-center gap-2 border-t p-3", collapsed && "flex-col")}>
                <BrandMark className="size-6 text-foreground" />
                {/* "Powered by" only makes sense under a customer's own brand (white label). */}
                {!collapsed &&
                  (org.logoUrl ? (
                    <span className="flex-1 text-xs text-muted-foreground">
                      {t("shell.poweredBy")}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  ))}
                <button
                  onClick={() => setCollapsed((c) => !c)}
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
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
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {!focusActive && (
              <header className="sticky top-0 z-30 flex h-14 items-center gap-1.5 border-b bg-background/85 px-3 backdrop-blur sm:gap-2 sm:px-4 md:px-6">
                <button
                  onClick={() => setMobileOpen(true)}
                  className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-secondary lg:hidden"
                  aria-label={t("a11y.openMenu")}
                >
                  <Menu className="size-5" strokeWidth={1.75} />
                </button>
                <LocationSelector className="max-w-[220px] sm:max-w-xs" />
                <button
                  onClick={() => setCmdOpen(true)}
                  className="ml-2 hidden h-9 w-48 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-input md:inline-flex xl:w-64"
                >
                  <Search className="size-4" strokeWidth={1.75} />
                  <span className="flex-1 text-left">{t("shell.search")}</span>
                  <ShortcutHint />
                </button>
                <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                  {/* One honest workspace-level indicator instead of a different badge on every page. */}
                  {org.fictional && (
                    <span title={t("demo.workspaceHint")} className="mr-1 inline-flex">
                      <DemoBadge label={t("demo.workspace")} className="hidden xl:inline-flex" />
                      <DemoBadge label={t("demo.workspaceShort")} className="px-2 xl:hidden" />
                    </span>
                  )}
                  <button
                    onClick={() => setCmdOpen(true)}
                    className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary md:hidden"
                    aria-label={t("shell.search")}
                  >
                    <Search className="size-4" strokeWidth={1.75} />
                  </button>
                  <PresentationModeToggle />
                  <LanguageQuick />
                  <Notifications />
                  <PreferencesMenu />
                </div>
              </header>
            )}

            <main
              id="main"
              className={cn(
                "min-w-0 flex-1 overflow-x-clip",
                focusActive ? "p-3 md:p-4" : "px-4 pb-28 pt-6 md:px-6 lg:px-8 lg:pb-12",
              )}
            >
              {orgStatus === "suspended" ? (
                <SuspendedState reason={suspendedReason} />
              ) : (
                <>
                  <PresentationBanner />
                  {!focusActive && <OnboardingProgress />}
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
              <SidebarNav onNavigate={() => setMobileOpen(false)} counts={counts} />
            </SheetContent>
          </Sheet>

          {/* Mobile bottom nav */}
          {!focusActive && (
            <nav
              className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
              aria-label={t("a11y.mobileNav")}
            >
              {barItems.map(({ to, key, icon: Icon }) => {
                const badge = badgeFor(to);
                return (
                  <Link
                    key={to}
                    to={to}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                      isActive(to) ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span className="relative">
                      <Icon className="size-5" strokeWidth={1.75} />
                      {badge && (
                        <CountBadge
                          badge={badge}
                          className="absolute -right-3.5 -top-2 h-4 min-w-4 px-1 text-[10px]"
                        />
                      )}
                    </span>
                    {t(`nav.${key}`)}
                    {badge && <span className="sr-only">, {badge.label}</span>}
                  </Link>
                );
              })}
              <button
                onClick={() => setMobileOpen(true)}
                aria-label={
                  moreAlerts.length
                    ? [t("nav.more"), ...moreAlerts.map((b) => b.label)].join(", ")
                    : undefined
                }
                className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
              >
                <span className="relative">
                  <MoreHorizontal className="size-5" strokeWidth={1.75} />
                  {moreDot && <CountDot badge={moreDot} className="ring-card" />}
                </span>
                {t("nav.more")}
              </button>
            </nav>
          )}

          <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
        </div>
      </TooltipProvider>
    </FocusModeContext.Provider>
  );
}
