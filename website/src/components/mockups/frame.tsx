import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  BookOpenText,
  Boxes,
  ChartNoAxesCombined,
  CookingPot,
  CreditCard,
  Gauge,
  Landmark,
  Lock,
  MapPinned,
  MonitorSmartphone,
  ReceiptText,
  SwatchBook,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../ui";
import { pick, useLocale, useT } from "../../i18n/locale";

/**
 * Renders a fixed-width product mockup and scales it down proportionally to
 * fit its container. Keeps the interface pixel-faithful on every screen size.
 */
export function ScaledFrame({ width, children, className }: { width: number; children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const s = Math.min(1, o.clientWidth / width);
      setScale(s);
      setHeight(i.offsetHeight * s);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className={cx("relative w-full", className)} style={height ? { height } : undefined}>
      <div
        ref={inner}
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

type NavKey =
  | "overview"
  | "pos"
  | "kds"
  | "menu"
  | "inventory"
  | "finance"
  | "intelligence"
  | "locations"
  | "team";

type Label = { en: string; pt: string };

const NAV: { key: NavKey | "branding" | "billing"; label: Label; icon: LucideIcon }[] = [
  { key: "overview", label: { en: "Overview", pt: "Visão geral" }, icon: Gauge },
  { key: "pos", label: { en: "Point of sale", pt: "Ponto de venda" }, icon: MonitorSmartphone },
  { key: "kds", label: { en: "Kitchen display", pt: "Tela da cozinha" }, icon: CookingPot },
  { key: "menu", label: { en: "Menu", pt: "Cardápio" }, icon: BookOpenText },
  { key: "inventory", label: { en: "Inventory", pt: "Estoque" }, icon: Boxes },
  { key: "finance", label: { en: "Finance", pt: "Financeiro" }, icon: Landmark },
  { key: "intelligence", label: { en: "Intelligence", pt: "Inteligência" }, icon: ChartNoAxesCombined },
  { key: "locations", label: { en: "Locations", pt: "Unidades" }, icon: MapPinned },
  { key: "team", label: { en: "Team & access", pt: "Equipe e acessos" }, icon: UsersRound },
  { key: "branding", label: { en: "Branding", pt: "Marca" }, icon: SwatchBook },
  { key: "billing", label: { en: "Billing", pt: "Cobrança" }, icon: CreditCard },
];

const UPCOMING: { label: Label; icon: LucideIcon }[] = [
  { label: { en: "Live operations", pt: "Operação ao vivo" }, icon: Activity },
  { label: { en: "Orders", pt: "Pedidos" }, icon: ReceiptText },
  { label: { en: "Analytics", pt: "Análises" }, icon: ChartNoAxesCombined },
];

/**
 * Application window chrome + sidebar, mirroring the Dinequora app shell
 * (navigation labels, order, and "Coming next" section are taken from the app).
 */
export function AppWindow({
  active,
  children,
  compactNav = false,
}: {
  active: NavKey;
  children: ReactNode;
  compactNav?: boolean;
}) {
  const { locale } = useLocale();
  const t = useT();
  const activeLabel = NAV.find((n) => n.key === active)?.label[locale] ?? "";
  return (
    <div className="overflow-hidden rounded-[14px] bg-[#0a111d] text-[13px] text-offwhite shadow-[0_40px_120px_-30px_rgb(0_0_0/0.85),0_0_0_1px_rgb(169_185_201/0.16)]">
      {/* window bar */}
      <div className="flex h-10 items-center gap-3 border-b border-white/[0.06] bg-[#0d1524] px-4">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </div>
        <div className="mx-auto flex h-6 w-[340px] items-center justify-center rounded-md bg-white/[0.05] text-[11px] text-mist/80">
          Dinequora · {activeLabel}
        </div>
        <div className="w-10" />
      </div>
      <div className="flex">
        <aside
          className={cx(
            "shrink-0 border-r border-white/[0.06] bg-[#0c1422] px-3 py-4",
            compactNav ? "w-[64px]" : "w-[212px]",
          )}
        >
          <div className={cx("mb-5 flex items-center gap-2.5 px-2", compactNav && "justify-center px-0")}>
            <img src="/brand/dinequora_icone_transparente.svg" alt="" width={22} height={22} className="size-[22px]" />
            {!compactNav && (
              <div className="leading-tight">
                <div className="text-[12.5px] font-semibold">{t("Sample Bistro", "Bistrô Exemplo")}</div>
                <div className="text-[10.5px] text-mist/70">{t("All locations", "Todas as unidades")}</div>
              </div>
            )}
          </div>
          {!compactNav && <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-mist/50 uppercase">{t("Workspace", "Espaço de trabalho")}</div>}
          <nav className="space-y-0.5">
            {NAV.map(({ key, label, icon: Icon }) => (
              <div
                key={key}
                className={cx(
                  "flex h-8 items-center gap-2.5 rounded-md px-2 text-[12.5px]",
                  compactNav && "justify-center",
                  key === active ? "bg-emerald/12 text-offwhite" : "text-mist/80",
                )}
              >
                <Icon className={cx("size-[15px]", key === active ? "text-emerald" : "text-mist/60")} strokeWidth={1.75} />
                {!compactNav && label[locale]}
              </div>
            ))}
          </nav>
          {!compactNav && (
            <>
              <div className="mt-5 px-2 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-mist/50 uppercase">{t("Coming next", "Em breve")}</div>
              <div className="space-y-0.5">
                {UPCOMING.map(({ label, icon: Icon }) => (
                  <div key={label.en} className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[12.5px] text-mist/40">
                    <Icon className="size-[15px]" strokeWidth={1.75} />
                    {label[locale]}
                    <Lock className="ml-auto size-3" strokeWidth={2} />
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
        <main className="min-w-0 flex-1 bg-[#0a111d] p-6">{children}</main>
      </div>
    </div>
  );
}

export function SampleDataNote({ children }: { children?: ReactNode }) {
  const { locale } = useLocale();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-mist ring-1 ring-white/10">
      <span aria-hidden className="size-1.5 rounded-full bg-amber" />
      {children ?? pick(locale, "Sample data", "Dados de exemplo")}
    </span>
  );
}

export function PanelCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-white/[0.07] bg-[#0f1828] p-4", className)}>{children}</div>;
}
