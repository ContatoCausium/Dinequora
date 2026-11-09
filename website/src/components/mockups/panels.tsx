/**
 * Static recreations of real Dinequora application screens. Layout, labels,
 * columns, and statuses follow the app; every figure is illustrative sample data.
 *
 * In Portuguese the screens are shown translated for illustration only; the
 * application interface itself is in English today (the site says so).
 */
import { ArrowUpRight, Bell, ChefHat, Clock, Download, Filter, Plus, Search, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../ui";
import { PanelCard, SampleDataNote } from "./frame";
import { useLocale, useT, type Locale } from "../../i18n/locale";

type T = <V>(en: V, pt: V) => V;

/* --------------------------------------------------------------- shared */

/** Sample money values: "$2,184.00" in English, "US$ 2.184,00" in Portuguese. */
function money(amount: number, locale: Locale, cents = false): string {
  return new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

function num(value: number, locale: Locale): string {
  return value.toLocaleString(locale === "pt" ? "pt-BR" : "en-US");
}

function PanelHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode | undefined }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <div className="mb-1.5">
          <SampleDataNote />
        </div>
        <h3 className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-mist/70">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function Segmented({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="flex rounded-lg bg-white/[0.05] p-0.5 text-[11.5px]">
      {items.map((label, i) => (
        <span key={label} className={cx("rounded-md px-2.5 py-1", i === active ? "bg-white/10 text-offwhite" : "text-mist/70")}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Spark({ points, color = "#10B981" }: { points: number[]; color?: string }) {
  const w = 90;
  const h = 28;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * w},${h - ((p - min) / (max - min || 1)) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------- Overview */

const revenueSeries = {
  downtown: [62, 64, 61, 70, 74, 80, 77, 72, 75, 79, 86, 90, 84, 82, 88, 93, 97, 92, 89, 95, 99, 104, 98, 96, 101, 108, 112, 106, 103, 110],
  midtown: [41, 43, 40, 45, 49, 52, 50, 47, 49, 51, 55, 58, 54, 53, 57, 60, 62, 59, 57, 61, 63, 67, 63, 62, 65, 69, 72, 68, 66, 71],
  riverside: [28, 29, 27, 31, 33, 36, 34, 32, 33, 35, 38, 40, 37, 36, 39, 41, 43, 41, 39, 42, 44, 46, 44, 43, 45, 48, 50, 47, 46, 49],
};

function StackedArea() {
  const w = 560;
  const h = 170;
  const n = revenueSeries.downtown.length;
  const stack = revenueSeries.downtown.map((d, i) => {
    const r = revenueSeries.riverside[i] ?? 0;
    const m = revenueSeries.midtown[i] ?? 0;
    return [r, r + m, r + m + d] as const;
  });
  const max = 240;
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const area = (top: number, bottom: number | null) => {
    const upper = stack.map((s, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(s[top] ?? 0)}`).join(" ");
    const lower =
      bottom === null
        ? `L${w},${h} L0,${h} Z`
        : stack
            .map((s, i) => [x(i), y(s[bottom] ?? 0)] as const)
            .reverse()
            .map(([px, py]) => `L${px},${py}`)
            .join(" ") + " Z";
    return `${upper} ${lower}`;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[170px] w-full" preserveAspectRatio="none" aria-hidden>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={0} x2={w} y1={h * t} y2={h * t} stroke="rgb(169 185 201 / 0.08)" />
      ))}
      <path d={area(0, null)} fill="rgb(16 185 129 / 0.22)" />
      <path d={area(1, 0)} fill="rgb(16 185 129 / 0.45)" />
      <path d={area(2, 1)} fill="rgb(16 185 129 / 0.8)" />
    </svg>
  );
}

export function OverviewPanel() {
  const { locale } = useLocale();
  const t = useT();
  const pct = (v: number) => `+${v.toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: 1 })}%`;
  const kpis = [
    { label: t("Gross sales", "Vendas brutas"), value: money(184920, locale), delta: pct(6.4), spark: [4, 5, 4.6, 5.4, 5.9, 5.6, 6.4, 6.8, 7.1] },
    { label: t("Net sales", "Vendas líquidas"), value: money(171305, locale), delta: pct(5.9), spark: [4, 4.4, 4.2, 5, 5.3, 5.1, 5.9, 6.2, 6.5] },
    { label: t("Total orders", "Total de pedidos"), value: num(6842, locale), delta: pct(3.1), spark: [5, 5.2, 5.1, 5.5, 5.4, 5.8, 5.9, 6.1, 6.2] },
    { label: t("Avg. order value", "Ticket médio"), value: money(27.03, locale, true), delta: pct(3.2), spark: [5, 4.9, 5.2, 5.1, 5.4, 5.3, 5.5, 5.6, 5.7] },
  ];
  const stores = [
    { name: "Downtown", share: 48, orders: num(3212, locale), growth: pct(7.8) },
    { name: "Midtown", share: 31, orders: num(2140, locale), growth: pct(5.2) },
    { name: "Riverside", share: 21, orders: num(1490, locale), growth: pct(4.1) },
  ];
  const alerts = [
    { sev: t("High", "Alta"), tone: "text-rose bg-rose/10", text: t("4 ingredients below minimum", "4 ingredientes abaixo do mínimo"), where: "Midtown" },
    { sev: t("Medium", "Média"), tone: "text-amber bg-amber/10", text: t("2 orders delayed over 20 min", "2 pedidos atrasados há mais de 20 min"), where: "Downtown" },
    { sev: t("Low", "Baixa"), tone: "text-mist bg-white/[0.06]", text: t("End-of-day closing missing", "Fechamento do dia pendente"), where: "Riverside" },
  ];
  return (
    <div>
      <PanelHeader
        title={t("Executive overview", "Visão executiva")}
        subtitle={t("All locations · Last 30 days", "Todas as unidades · Últimos 30 dias")}
        right={<Segmented items={t(["7 days", "30 days", "90 days"], ["7 dias", "30 dias", "90 dias"])} active={1} />}
      />
      <div className="grid grid-cols-4 gap-3">
        {kpis.map((k) => (
          <PanelCard key={k.label} className="p-3.5">
            <div className="text-[11.5px] text-mist/75">{k.label}</div>
            <div className="mt-1.5 flex items-end justify-between">
              <div className="text-[21px] font-semibold tracking-[-0.02em] tabular-nums">{k.value}</div>
              <Spark points={k.spark} />
            </div>
            <div className="mt-1 text-[11px] text-emerald">
              {k.delta} <span className="text-mist/60">{t("vs. prior period", "vs. período anterior")}</span>
            </div>
          </PanelCard>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <PanelCard className="col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold">{t("Revenue", "Faturamento")}</div>
              <div className="text-[11px] text-mist/65">
                {t("Gross sales, 30 days · stacked by location", "Vendas brutas, 30 dias · empilhado por unidade")}
              </div>
            </div>
            <div className="flex gap-3 text-[10.5px] text-mist/75">
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-emerald/80" />Downtown</span>
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-emerald/45" />Midtown</span>
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-emerald/22" />Riverside</span>
            </div>
          </div>
          <StackedArea />
        </PanelCard>
        <PanelCard>
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <Bell className="size-3.5 text-mist/70" /> {t("Operational alerts", "Alertas operacionais")}
          </div>
          <ul className="space-y-2.5">
            {alerts.map((a) => (
              <li key={a.text} className="rounded-lg border border-white/[0.06] p-2.5">
                <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-semibold", a.tone)}>{a.sev}</span>
                <div className="mt-1.5 text-[12px] leading-snug">{a.text}</div>
                <div className="text-[10.5px] text-mist/60">{a.where}</div>
              </li>
            ))}
          </ul>
        </PanelCard>
      </div>
      <PanelCard className="mt-3">
        <div className="mb-3 text-[13px] font-semibold">{t("Store comparison", "Comparação entre unidades")}</div>
        <div className="space-y-2.5">
          {stores.map((s) => (
            <div key={s.name} className="grid grid-cols-[110px_1fr_70px_60px] items-center gap-3 text-[12px]">
              <span>{s.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <span className="block h-full rounded-full bg-emerald" style={{ width: `${s.share * 1.9}%` }} />
              </span>
              <span className="text-right text-mist/75 tabular-nums">{s.orders}</span>
              <span className="text-right text-emerald tabular-nums">{s.growth}</span>
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}

/* ------------------------------------------------------------------ KDS */

type Ticket = { id: string; where: string; mode: string; age: string; items: string[]; urgency?: "warn" | "late" };
type KdsColumn = { title: string; action: string; tickets: Ticket[] };

function getKdsColumns(t: T): KdsColumn[] {
  const dineIn = t("Dine in", "No local");
  const table = t("Table", "Mesa");
  return [
    {
      title: t("New Orders", "Novos pedidos"),
      action: t("Start Cooking", "Iniciar preparo"),
      tickets: [
        {
          id: "#1048",
          where: `${table} 7`,
          mode: dineIn,
          age: "1:12",
          items: t(
            ["2× Smash Burger", "1× Truffle Fries", "1× Caesar Salad"],
            ["2× Smash Burger", "1× Batata trufada", "1× Salada Caesar"],
          ),
        },
        {
          id: "#1049",
          where: "Online",
          mode: t("Takeout", "Retirada"),
          age: "0:34",
          items: t(["1× Margherita Pizza", "2× Lemonade"], ["1× Pizza Margherita", "2× Limonada"]),
        },
      ],
    },
    {
      title: t("In Preparation", "Em preparo"),
      action: t("Mark Ready", "Marcar pronto"),
      tickets: [
        {
          id: "#1045",
          where: `${table} 3`,
          mode: dineIn,
          age: "11:40",
          urgency: "warn",
          items: t(["1× Ribeye 12oz · medium", "1× Mashed Potatoes"], ["1× Ribeye 340 g · ao ponto", "1× Purê de batata"]),
        },
        { id: "#1046", where: t("Bar", "Bar"), mode: dineIn, age: "6:05", items: t(["3× Fish Tacos", "1× Elote"], ["3× Tacos de peixe", "1× Elote"]) },
      ],
    },
    {
      title: t("Ready for Pickup", "Pronto para retirada"),
      action: t("Fulfill", "Entregar"),
      tickets: [
        {
          id: "#1043",
          where: t("Courier", "Entregador"),
          mode: t("Delivery", "Entrega"),
          age: "21:18",
          urgency: "late",
          items: t(["2× Chicken Bowl", "1× Brownie"], ["2× Bowl de frango", "1× Brownie"]),
        },
      ],
    },
    {
      title: t("Completed (Recent)", "Concluídos (recentes)"),
      action: t("Reopen", "Reabrir"),
      tickets: [{ id: "#1041", where: `${table} 9`, mode: dineIn, age: "—", items: t(["2× Pasta Carbonara"], ["2× Massa à carbonara"]) }],
    },
  ];
}

export function KdsPanel({ dense = false }: { dense?: boolean }) {
  const t = useT();
  const kdsColumns = getKdsColumns(t);
  return (
    <div>
      <PanelHeader
        title={t("Kitchen Display System (KDS)", "Tela da cozinha (KDS)")}
        subtitle={t("Downtown · All Stations", "Downtown · Todas as estações")}
        right={
          <span className="flex items-center gap-2 rounded-full bg-emerald/10 px-2.5 py-1 text-[11px] font-medium text-emerald ring-1 ring-emerald/25">
            <span className="live-dot size-1.5 rounded-full bg-emerald" /> {t("Live", "Ao vivo")}
          </span>
        }
      />
      <div className="mb-4 flex gap-1.5 text-[11.5px]">
        {t(
          ["All Stations", "Grill", "Fryer", "Assembly", "Bar & Drinks", "Expo"],
          ["Todas as estações", "Grelha", "Fritadeira", "Montagem", "Bar e bebidas", "Expedição"],
        ).map((s, i) => (
          <span key={s} className={cx("rounded-full px-3 py-1", i === 0 ? "bg-offwhite text-navy" : "bg-white/[0.05] text-mist/80")}>
            {s}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {kdsColumns.map((col) => (
          <div key={col.title} className="rounded-xl bg-white/[0.025] p-2.5">
            <div className="mb-2.5 flex items-center justify-between px-1 text-[12px] font-semibold">
              {col.title}
              <span className="rounded-full bg-white/[0.07] px-1.5 text-[10.5px] text-mist">{col.tickets.length}</span>
            </div>
            <div className="space-y-2.5">
              {col.tickets.slice(0, dense ? 1 : 2).map((ticket) => (
                <KdsTicket key={ticket.id} ticket={ticket} action={col.action} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KdsTicket({ ticket: tk, action }: { ticket: Ticket; action: string }) {
  return (
    <div
      className={cx(
        "rounded-lg border bg-[#111b2d] p-3",
        tk.urgency === "late" ? "border-rose/40" : tk.urgency === "warn" ? "border-amber/40" : "border-white/[0.07]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">{tk.id}</span>
        <span
          className={cx(
            "flex items-center gap-1 text-[11px] tabular-nums",
            tk.urgency === "late" ? "text-rose" : tk.urgency === "warn" ? "text-amber" : "text-mist/70",
          )}
        >
          <Clock className="size-3" /> {tk.age}
        </span>
      </div>
      <div className="mt-0.5 text-[10.5px] text-mist/65">
        {tk.where} · {tk.mode}
      </div>
      <ul className="mt-2 space-y-1 text-[11.5px] text-offwhite/90">
        {tk.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <div className="mt-2.5 rounded-md bg-white/[0.06] py-1.5 text-center text-[11px] font-medium">{action}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ POS */

function getPosItems(t: T) {
  return [
    { name: "Smash Burger", desc: t("Double patty, cheddar", "Dois hambúrgueres, cheddar"), price: 16 },
    { name: t("Ribeye 12oz", "Ribeye 340 g"), desc: t("Herb butter", "Manteiga de ervas"), price: 38 },
    { name: t("Fish Tacos", "Tacos de peixe"), desc: t("Baja slaw, lime", "Salada de repolho, limão"), price: 15.5 },
    { name: t("Chicken Bowl", "Bowl de frango"), desc: t("Rice, greens", "Arroz, folhas"), price: 14 },
    { name: t("Pasta Carbonara", "Massa à carbonara"), desc: t("Guanciale, pecorino", "Guanciale, pecorino"), price: 19 },
    { name: t("Caesar Salad", "Salada Caesar"), desc: t("Parmesan, croutons", "Parmesão, croutons"), price: 12 },
    { name: t("Truffle Fries", "Batata trufada"), desc: t("Parmesan, herbs", "Parmesão, ervas"), price: 9 },
    { name: t("Margherita Pizza", "Pizza Margherita"), desc: t("Fior di latte", "Fior di latte"), price: 17 },
  ];
}

export function PosPanel() {
  const { locale } = useLocale();
  const t = useT();
  return (
    <div className="grid grid-cols-[1fr_300px] gap-4">
      <div>
        <PanelHeader title={t("Point of sale", "Ponto de venda")} subtitle={t("Downtown · Register 1", "Downtown · Caixa 1")} />
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-2 text-[12px] text-mist/60">
          <Search className="size-3.5" /> {t("Search menu items", "Buscar itens do cardápio")}
        </div>
        <div className="mb-3 flex gap-1.5 text-[11.5px]">
          {t(
            ["All", "Starters", "Mains", "Sides", "Drinks", "Desserts"],
            ["Todos", "Entradas", "Pratos principais", "Acompanhamentos", "Bebidas", "Sobremesas"],
          ).map((c, i) => (
            <span key={c} className={cx("rounded-full px-3 py-1", i === 2 ? "bg-offwhite text-navy" : "bg-white/[0.05] text-mist/80")}>
              {c}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {getPosItems(t).map((p) => (
            <div key={p.name} className="rounded-lg border border-white/[0.07] bg-[#0f1828] p-3">
              <div className="text-[12.5px] font-medium">{p.name}</div>
              <div className="mt-0.5 text-[10.5px] text-mist/60">{p.desc}</div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[12.5px] font-semibold tabular-nums">{money(p.price, locale, true)}</span>
                <span className="grid size-6 place-items-center rounded-md bg-emerald/15 text-emerald">
                  <Plus className="size-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <PosTicket />
    </div>
  );
}

export function PosTicket() {
  const { locale } = useLocale();
  const t = useT();
  const m = (n: number) => money(n, locale, true);
  const lines: [string, number][] = [
    [t("1× Ribeye 12oz", "1× Ribeye 340 g"), 38],
    [t("1× Caesar Salad", "1× Salada Caesar"), 12],
    [t("2× Truffle Fries", "2× Batata trufada"), 18],
  ];
  return (
    <div className="flex flex-col rounded-xl border border-white/[0.08] bg-[#0f1828] p-4">
      <div className="text-[13.5px] font-semibold">{t("Current Ticket", "Pedido atual")}</div>
      <div className="mt-0.5 text-[11px] text-mist/65">{t("Attendant: Jordan", "Atendente: Jordan")}</div>
      <div className="mt-3">
        <Segmented items={t(["Dine in", "Takeout", "Delivery"], ["No local", "Retirada", "Entrega"])} active={0} />
      </div>
      <div className="mt-3 rounded-md bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-mist/75">{t("Table 3", "Mesa 3")}</div>
      <ul className="mt-3 space-y-2 text-[12px]">
        {lines.map(([l, p]) => (
          <li key={l} className="flex justify-between">
            <span>{l}</span>
            <span className="tabular-nums text-mist">{m(p)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1.5 border-t border-white/[0.07] pt-3 text-[11.5px] text-mist/80">
        <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{m(68)}</dd></div>
        <div className="flex justify-between"><dt>{t("Discount", "Desconto")}</dt><dd className="tabular-nums">{m(0)}</dd></div>
        <div className="flex justify-between"><dt>{t("Tax (8%)", "Imposto (8%)")}</dt><dd className="tabular-nums">{m(5.44)}</dd></div>
        <div className="flex justify-between pt-1 text-[14px] font-semibold text-offwhite"><dt>Total</dt><dd className="tabular-nums">{m(73.44)}</dd></div>
      </dl>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px] text-mist">
        <span className="rounded-md bg-white/[0.05] py-1.5">{t("Discount", "Desconto")}</span>
        <span className="rounded-md bg-white/[0.05] py-1.5">{t("Hold", "Em espera")}</span>
        <span className="rounded-md bg-white/[0.05] py-1.5">{t("Clear", "Limpar")}</span>
      </div>
      <div className="mt-2 rounded-lg bg-emerald py-2.5 text-center text-[13px] font-semibold text-navy">
        {t("Charge", "Cobrar")} {m(73.44)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Inventory */

type StockStatus = "normal" | "low" | "out";

function getStock(t: T): { name: string; sku: string; supplier: string; qty: string; min: string; status: StockStatus }[] {
  const cs = t("cs", "cx");
  const ea = t("ea", "un");
  const jugs = t("jugs", "galões");
  return [
    { name: t("Ribeye, choice", "Ribeye (choice)"), sku: "MT-1102", supplier: "Prairie Meats", qty: "18 lb", min: "12 lb", status: "normal" },
    { name: t("Romaine hearts", "Alface romana"), sku: "PR-2210", supplier: "Valley Produce", qty: `6 ${cs}`, min: `8 ${cs}`, status: "low" },
    { name: t("Parmesan, aged", "Parmesão maturado"), sku: "DY-3104", supplier: "Coastal Dairy", qty: "9 lb", min: "4 lb", status: "normal" },
    { name: t("Russet potatoes", "Batata russet"), sku: "PR-2002", supplier: "Valley Produce", qty: "0 lb", min: "40 lb", status: "out" },
    { name: t("Brioche buns", "Pão brioche"), sku: "BK-4410", supplier: "Northside Bakery", qty: `64 ${ea}`, min: `48 ${ea}`, status: "normal" },
    { name: t("Fryer oil", "Óleo de fritura"), sku: "DG-5120", supplier: "Prairie Meats", qty: `2 ${jugs}`, min: `3 ${jugs}`, status: "low" },
  ];
}

function StockBadge({ status }: { status: StockStatus }) {
  const t = useT();
  const tone = status === "normal" ? "bg-emerald/10 text-emerald" : status === "low" ? "bg-amber/10 text-amber" : "bg-rose/10 text-rose";
  const label =
    status === "normal" ? t("Normal", "Normal") : status === "low" ? t("Low stock", "Estoque baixo") : t("Out of stock", "Sem estoque");
  return <span className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap", tone)}>{label}</span>;
}

export function InventoryPanel({ rows = 6 }: { rows?: number }) {
  const t = useT();
  return (
    <div>
      <PanelHeader
        title={t("Inventory & Ingredients", "Estoque e ingredientes")}
        subtitle={t("Midtown · 142 items", "Midtown · 142 itens")}
        right={
          <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-[11.5px] text-mist">
            <Filter className="size-3.5" /> {t("Filters", "Filtros")}
          </span>
        }
      />
      <div className="mb-3 flex gap-5 border-b border-white/[0.07] text-[12px]">
        {t(
          ["Inventory", "Movements", "Recipes", "Suppliers", "Purchase orders"],
          ["Estoque", "Movimentações", "Fichas técnicas", "Fornecedores", "Pedidos de compra"],
        ).map((tab, i) => (
          <span key={tab} className={cx("pb-2", i === 0 ? "border-b-2 border-emerald text-offwhite" : "text-mist/65")}>
            {tab}
          </span>
        ))}
      </div>
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10.5px] tracking-wide text-mist/55 uppercase">
          <tr>
            <th className="py-2 font-medium">{t("Item", "Item")}</th>
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">{t("Supplier", "Fornecedor")}</th>
            <th className="py-2 text-right font-medium">{t("Qty / Min", "Qtd. / Mín.")}</th>
            <th className="py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {getStock(t)
            .slice(0, rows)
            .map((s) => (
              <tr key={s.sku} className="border-t border-white/[0.05]">
                <td className="py-2.5 font-medium">{s.name}</td>
                <td className="py-2.5 text-mist/65 tabular-nums">{s.sku}</td>
                <td className="py-2.5 text-mist/80">{s.supplier}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {s.qty} <span className="text-mist/50">/ {s.min}</span>
                </td>
                <td className="py-2.5 text-right">
                  <StockBadge status={s.status} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------- Hero notices */

/** Shared look for the two cards floating beside the hero dashboard. */
function NoticeCard({
  icon,
  eyebrow,
  title,
  meta,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-[280px] rounded-2xl border border-white/[0.1] bg-[#0f1828]/80 p-4 text-offwhite shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9),0_0_0_1px_rgb(16_185_129/0.06)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald/12 text-emerald ring-1 ring-emerald/20">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-mist/65 uppercase">{eyebrow}</div>
          <div className="truncate text-[13.5px] font-semibold">{title}</div>
        </div>
        {meta}
      </div>
      <div className="mt-3.5 border-t border-white/[0.07] pt-3.5">{children}</div>
    </div>
  );
}

export function KitchenNotice() {
  const t = useT();
  const ticket = getKdsColumns(t)[1]!.tickets[0]!;
  return (
    <NoticeCard
      icon={<ChefHat className="size-[18px]" strokeWidth={1.75} />}
      eyebrow={t("Kitchen display", "Tela da cozinha")}
      title={`${ticket.id} · ${ticket.where}`}
      meta={
        <span className="flex items-center gap-1 rounded-full bg-amber/10 px-2 py-0.5 text-[11px] font-medium text-amber tabular-nums">
          <Clock className="size-3" /> {ticket.age}
        </span>
      }
    >
      <ul className="space-y-1.5 text-[12px] text-offwhite/90">
        {ticket.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-mist/75">
          <span className="live-dot size-1.5 rounded-full bg-emerald" /> {t("In preparation", "Em preparo")}
        </span>
        <span className="rounded-lg bg-emerald px-2.5 py-1 text-[11px] font-semibold text-navy">{t("Mark Ready", "Marcar pronto")}</span>
      </div>
    </NoticeCard>
  );
}

export function StockNotice() {
  const t = useT();
  const items = getStock(t).filter((s) => s.status !== "normal");
  return (
    <NoticeCard
      icon={<TriangleAlert className="size-[18px]" strokeWidth={1.75} />}
      eyebrow={t("Inventory · Midtown", "Estoque · Midtown")}
      title={t(`${items.length} items need attention`, `${items.length} itens precisam de atenção`)}
    >
      <ul className="space-y-2 text-[12px]">
        {items.map((s) => (
          <li key={s.sku} className="flex items-center justify-between gap-2">
            <span className="truncate">{s.name}</span>
            <StockBadge status={s.status} />
          </li>
        ))}
      </ul>
    </NoticeCard>
  );
}

/* -------------------------------------------------------------- Finance */

const expenseMix = [
  { key: "ingredients", label: { en: "Ingredients", pt: "Ingredientes" }, pct: 38, color: "#10B981" },
  { key: "payroll", label: { en: "Payroll", pt: "Folha" }, pct: 29, color: "#34D399" },
  { key: "rent", label: { en: "Rent", pt: "Aluguel" }, pct: 14, color: "#6EE7B7" },
  { key: "utilities", label: { en: "Utilities", pt: "Contas de consumo" }, pct: 8, color: "#A9B9C9" },
  { key: "other", label: { en: "Other", pt: "Outros" }, pct: 11, color: "#475569" },
];

function Donut() {
  const r = 42;
  const c = 2 * Math.PI * r;
  const segments = expenseMix.map((e, i) => {
    const before = expenseMix.slice(0, i).reduce((sum, x) => sum + x.pct, 0);
    return { ...e, len: (e.pct / 100) * c, offset: (before / 100) * c };
  });
  return (
    <svg viewBox="0 0 110 110" className="size-[118px] -rotate-90" aria-hidden>
      {segments.map((e) => (
        <circle
          key={e.key}
          cx={55}
          cy={55}
          r={r}
          fill="none"
          stroke={e.color}
          strokeWidth={13}
          strokeDasharray={`${e.len - 1.5} ${c - e.len + 1.5}`}
          strokeDashoffset={-e.offset}
        />
      ))}
    </svg>
  );
}

type ExpenseStatus = "pending" | "paid" | "overdue";

export function FinancePanel({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const t = useT();
  const cards = [
    { label: t("Estimated Net Profit", "Lucro líquido estimado"), value: money(21480, locale), note: t("This cycle", "Neste ciclo") },
    { label: t("Operating Expenses", "Despesas operacionais"), value: money(48236, locale), note: t("42 entries", "42 lançamentos") },
    { label: t("Pending Payables", "Contas a pagar"), value: money(6912, locale), note: t("5 due this week", "5 vencem nesta semana") },
    { label: t("Settled This Cycle", "Quitado no ciclo"), value: money(41324, locale), note: t("37 paid", "37 pagas") },
  ];
  const expenses: { d: string; c: string; due: string; a: number; s: ExpenseStatus }[] = [
    {
      d: t("Valley Produce — weekly order", "Valley Produce — pedido semanal"),
      c: t("Ingredients", "Ingredientes"),
      due: t("Nov 12", "12 nov"),
      a: 2184,
      s: "pending",
    },
    { d: t("Kitchen hood service", "Manutenção da coifa"), c: t("Maintenance", "Manutenção"), due: t("Nov 10", "10 nov"), a: 420, s: "paid" },
    {
      d: t("November rent — Downtown", "Aluguel de novembro — Downtown"),
      c: t("Rent", "Aluguel"),
      due: t("Nov 1", "1º nov"),
      a: 9500,
      s: "paid",
    },
    { d: t("Electric utility", "Conta de luz"), c: t("Utilities", "Contas de consumo"), due: t("Nov 4", "4 nov"), a: 1236.4, s: "overdue" },
  ];
  const statusLabel: Record<ExpenseStatus, string> = {
    pending: t("Pending", "Pendente"),
    paid: t("Paid", "Paga"),
    overdue: t("Overdue", "Vencida"),
  };
  return (
    <div>
      <PanelHeader
        title={t("Finance & Profitability", "Financeiro e lucratividade")}
        subtitle={t("All locations · November", "Todas as unidades · Novembro")}
        right={
          compact ? undefined : (
            <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-[11.5px] text-mist">
              <Download className="size-3.5" /> {t("Export CSV", "Exportar CSV")}
            </span>
          )
        }
      />
      <div className="mb-4 flex gap-5 border-b border-white/[0.07] text-[12px]">
        {t(
          ["Executive Overview", "Store Comparison", "P&L Statement", "Cash Flow Statement", "Payables", "Reports & Exports"],
          ["Visão executiva", "Comparação de unidades", "DRE", "Fluxo de caixa", "Contas a pagar", "Relatórios e exportações"],
        ).map((tab, i) => (
          <span key={tab} className={cx("pb-2 whitespace-nowrap", i === 0 ? "border-b-2 border-emerald text-offwhite" : "text-mist/65")}>
            {tab}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {cards.map((c) => (
          <PanelCard key={c.label} className="p-3.5">
            <div className="text-[11.5px] text-mist/75">{c.label}</div>
            <div className="mt-1.5 text-[21px] font-semibold tracking-[-0.02em] tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-mist/55">{c.note}</div>
          </PanelCard>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[250px_1fr] gap-3">
        <PanelCard>
          <div className="mb-3 text-[13px] font-semibold">{t("Expense Composition", "Composição das despesas")}</div>
          <div className="flex items-center gap-4">
            <Donut />
            <ul className="space-y-1.5 text-[11px]">
              {expenseMix.map((e) => (
                <li key={e.key} className="flex items-center gap-2 text-mist/85">
                  <i className="size-2 rounded-sm" style={{ background: e.color }} />
                  {e.label[locale]}
                  <span className="ml-auto pl-2 tabular-nums text-mist/60">{e.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
        </PanelCard>
        <PanelCard>
          <div className="mb-2 flex items-center justify-between text-[13px] font-semibold">
            {t("Expenses", "Despesas")}
            <span className="flex items-center gap-1 text-[11px] font-normal text-emerald">
              {t("View all", "Ver todas")} <ArrowUpRight className="size-3" />
            </span>
          </div>
          <table className="w-full text-left text-[11.5px]">
            <thead className="text-[10px] tracking-wide text-mist/50 uppercase">
              <tr>
                <th className="py-1.5 font-medium">{t("Description", "Descrição")}</th>
                <th className="py-1.5 font-medium">{t("Category", "Categoria")}</th>
                <th className="py-1.5 font-medium">{t("Due date", "Vencimento")}</th>
                <th className="py-1.5 text-right font-medium">{t("Amount", "Valor")}</th>
                <th className="py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {expenses.slice(0, compact ? 3 : 4).map((e) => (
                <tr key={e.d} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-2">{e.d}</td>
                  <td className="py-2 text-mist/70">{e.c}</td>
                  <td className="py-2 text-mist/70">{e.due}</td>
                  <td className="py-2 text-right tabular-nums">{money(e.a, locale, true)}</td>
                  <td className="py-2 text-right">
                    <span
                      className={cx(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        e.s === "paid" ? "bg-emerald/10 text-emerald" : e.s === "pending" ? "bg-white/[0.07] text-mist" : "bg-rose/10 text-rose",
                      )}
                    >
                      {statusLabel[e.s]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelCard>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- Locations / team */

type Role = "owner" | "manager" | "staff";

export function LocationAccessCard() {
  const t = useT();
  const roleLabel: Record<Role, string> = {
    owner: t("Owner", "Dono"),
    manager: t("Manager", "Gerente"),
    staff: t("Staff", "Funcionário"),
  };
  const people: { name: string; role: Role; access: string }[] = [
    { name: "Avery Chen", role: "owner", access: t("All locations", "Todas as unidades") },
    { name: "Marcus Hill", role: "manager", access: "Downtown, Midtown" },
    { name: "Priya Nair", role: "manager", access: "Riverside" },
    { name: "Jordan Lee", role: "staff", access: "Downtown" },
  ];
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0f1828] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{t("Team & access", "Equipe e acessos")}</div>
        <SampleDataNote />
      </div>
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10px] tracking-wide text-mist/50 uppercase">
          <tr>
            <th className="py-1.5 font-medium">{t("Member", "Membro")}</th>
            <th className="py-1.5 font-medium">{t("Role", "Função")}</th>
            <th className="py-1.5 font-medium">{t("Locations", "Unidades")}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.name} className="border-t border-white/[0.05]">
              <td className="py-2.5">
                <span className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-white/[0.07] text-[10px] font-semibold text-mist">
                    {p.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  {p.name}
                </span>
              </td>
              <td className="py-2.5">
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                    p.role === "owner" ? "bg-emerald/12 text-emerald" : p.role === "manager" ? "bg-white/[0.08] text-offwhite" : "bg-white/[0.04] text-mist",
                  )}
                >
                  {roleLabel[p.role]}
                </span>
              </td>
              <td className="py-2.5 text-mist/80">{p.access}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StoreComparisonCard() {
  const { locale } = useLocale();
  const t = useT();
  const rows = [
    { name: "Downtown", orders: 3212, expenses: 21940 },
    { name: "Midtown", orders: 2140, expenses: 15608 },
    { name: "Riverside", orders: 1490, expenses: 10688 },
  ];
  const max = 3212;
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0f1828] p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <ChefHat className="size-3.5 text-emerald" /> {t("Store comparison", "Comparação entre unidades")}
        </div>
        <SampleDataNote />
      </div>
      <div className="mb-3 text-[11px] text-mist/60">
        {t("Finance · Orders and expenses by location", "Financeiro · Pedidos e despesas por unidade")}
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex justify-between text-[12px]">
              <span>{r.name}</span>
              <span className="text-mist/70 tabular-nums">
                {num(r.orders, locale)} {t("orders", "pedidos")} · {money(r.expenses, locale)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-emerald" style={{ width: `${(r.orders / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
