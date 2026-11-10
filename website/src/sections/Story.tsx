import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { getFeatureCategories, type FeatureCategory } from "../content/features";
import { cx, StatusBadge } from "../components/ui";
import { FilmScene, Moment, segment, useSectionProgress, type FrameSet } from "../components/cinema/scene";
import { OrderFlow, RevenueChart, StockLevels } from "../components/cinema/charts";
import { pick, useLocale } from "../i18n/locale";

/* =====================================================================
   The story: a prologue, then one night of service in three chapters.
   ===================================================================== */

const RUSH: FrameSet = { dir: "/frames/pico", total: 120 };
const CLOSE: FrameSet = { dir: "/frames/fechamento", total: 120 };

/* ---------------------------------------------------------------- Prologue */

/** A statement whose words light up as the visitor scrolls. */
export function Prologue() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const { ref, progress } = useSectionProgress<HTMLElement>();
  const text = t(
    "Most restaurants run service on a register, a spreadsheet, a group chat and a notebook by the walk-in. Dinequora puts the floor, the kitchen, the stockroom and the office on one system, so the whole night tells one story.",
    "A maioria dos restaurantes toca o serviço com um caixa, uma planilha, um grupo de mensagens e um caderno ao lado da câmara fria. O Dinequora coloca o salão, a cozinha, o estoque e o escritório em um só sistema, e a noite inteira passa a contar uma única história.",
  );
  const words = text.split(" ");
  const lit = segment(progress, 0.08, 0.7) * words.length;

  const chapters = [
    { time: "18:00", href: "#chapter-prep", label: t("Before service", "Antes do serviço") },
    { time: "20:30", href: "#chapter-rush", label: t("The rush", "O pico") },
    { time: "23:30", href: "#chapter-close", label: t("Closing", "O fechamento") },
  ];

  return (
    <section id="platform" ref={ref} aria-labelledby="prologue-title" className="relative bg-navy-950" style={{ height: "230svh" }}>
      <div className="sticky top-0 flex h-svh items-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_50%,rgb(16_185_129/0.07),transparent)]" aria-hidden />
        <div className="container-page relative">
          <h2 id="prologue-title" className="eyebrow text-emerald">
            {t("The platform", "A plataforma")}
          </h2>
          <p className="mt-8 max-w-5xl text-[1.6rem] leading-[1.3] font-medium tracking-[-0.02em] sm:text-4xl lg:text-[3.1rem]">
            {words.map((w, i) => (
              <span key={i} className="transition-colors duration-300" style={{ color: i < lit ? "#f8fafc" : "rgb(169 185 201 / 0.22)" }}>
                {w}{" "}
              </span>
            ))}
          </p>
          <nav
            aria-label={t("Chapters", "Capítulos")}
            className={cx(
              "mt-12 flex flex-wrap gap-3 transition-all duration-700",
              progress > 0.68 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
            )}
          >
            {chapters.map((c) => (
              <a
                key={c.time}
                href={c.href}
                className="group flex items-center gap-3 rounded-full border border-line-dark bg-white/[0.03] py-2 pr-5 pl-2 text-sm text-offwhite transition-colors hover:border-emerald/40"
              >
                <span className="rounded-full bg-emerald/12 px-3 py-1 font-semibold text-emerald tabular-nums">{c.time}</span>
                {c.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Shared chapter bits */

type ChapterCopy = { time: string; eyebrow: string; title: string; accent: string; lead: string };

function ChapterText({ copy, category, limit = 4 }: { copy: ChapterCopy; category: FeatureCategory; limit?: number }) {
  return (
    <div className="cine-panel max-w-xl">
      <div className="flex items-center gap-4">
        <span className="font-serif text-5xl text-emerald italic tabular-nums sm:text-6xl">{copy.time}</span>
        <span className="eyebrow text-mist/80">{copy.eyebrow}</span>
      </div>
      <h2 className="heading mt-5 text-[1.9rem] text-offwhite sm:text-[2.6rem]">
        {copy.title} <span className="accent-serif text-emerald">{copy.accent}</span>
      </h2>
      <p className="mt-4 max-w-md leading-relaxed text-mist">{copy.lead}</p>
      <ul className="mt-6 space-y-2.5">
        {category.capabilities.slice(0, limit).map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-2.5 text-sm text-offwhite/90">
            <span>{c.name}</span>
            <StatusBadge status={c.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Lays out a chapter: on wide screens the text and the live card sit side by side;
 * on phones the text plays first and the card takes its place as the visitor scrolls.
 * Only one copy is ever visible, so assistive technology reads it once.
 */
function ChapterStage({
  p,
  text,
  card,
  cardSide,
  cardFrom = 0.06,
}: {
  p: number;
  text: ReactNode;
  card: (progress: number) => ReactNode;
  cardSide: "left" | "right";
  cardFrom?: number;
}) {
  const wide = useWide();
  if (wide) {
    const live = (
      <Moment p={p} from={cardFrom} to={1}>
        {card(segment(p, cardFrom + 0.02, 0.92))}
      </Moment>
    );
    return (
      <div
        className={cx(
          "container-page relative grid h-full items-center gap-10 py-24",
          cardSide === "right" ? "grid-cols-[minmax(0,1fr)_minmax(0,520px)]" : "grid-cols-[minmax(0,560px)_minmax(0,1fr)]",
        )}
      >
        {cardSide === "left" && live}
        <div className={cx(cardSide === "left" && "justify-self-end")}>{text}</div>
        {cardSide === "right" && live}
      </div>
    );
  }
  return (
    <div className="container-page relative grid h-full grid-cols-[minmax(0,1fr)] items-center py-20">
      <Moment p={p} from={0} to={0.45} className="[grid-area:1/1]">
        {text}
      </Moment>
      <Moment p={p} from={0.45} to={1} className="[grid-area:1/1]">
        {card(segment(p, 0.47, 0.95))}
      </Moment>
    </div>
  );
}

/** True on screens ≥1024px (Tailwind `lg`). Defaults to wide where matchMedia is unavailable. */
function useWide() {
  const query = "(min-width: 1024px)";
  const get = () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true);
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/* ---------------------------------------------------- Chapter 1 · Before service */

function ChapterPrep({ category }: { category: FeatureCategory }) {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const { ref, progress } = useSectionProgress<HTMLElement>();
  const copy: ChapterCopy = {
    time: "18:00",
    eyebrow: t("Chapter 1 · Before service", "Capítulo 1 · Antes do serviço"),
    title: t("Know what's on the shelf", "Saiba o que tem na prateleira"),
    accent: t("before the first ticket.", "antes do primeiro pedido."),
    lead: t(
      "Stock levels, minimums and suppliers in one place. Low items stand out, and the purchase order is a few clicks away.",
      "Níveis de estoque, mínimos e fornecedores num lugar só. O que está baixo aparece na hora, e o pedido de compra fica a poucos cliques.",
    ),
  };
  return (
    <section
      id="chapter-prep"
      ref={ref}
      aria-label={t("Chapter 1: before service", "Capítulo 1: antes do serviço")}
      className="relative bg-navy-950"
      style={{ height: "280svh" }}
    >
      <div className="sticky top-0 h-svh overflow-hidden">
        <img
          src="/images/cinema/estoque.webp"
          alt=""
          aria-hidden
          loading="lazy"
          className="art-right absolute inset-y-0 right-0 h-full w-full object-cover lg:w-[70vw]"
          style={{ transform: `scale(${1.12 - progress * 0.1}) translateY(${(progress - 0.5) * -40}px)` } as CSSProperties}
        />
        <div className="pointer-events-none absolute inset-0 bg-[rgb(7_12_21/0.55)] lg:bg-[linear-gradient(90deg,#070c15_0%,rgb(7_12_21/0.7)_40%,transparent_75%)]" />
        <ChapterStage
          p={progress}
          cardSide="right"
          cardFrom={0}
          card={(cp) => <StockLevels p={cp} />}
          text={<ChapterText copy={copy} category={category} />}
        />
      </div>
    </section>
  );
}

/* --------------------------------------------------------- Chapter 2 · The rush */

function ChapterRush({ category }: { category: FeatureCategory }) {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const copy: ChapterCopy = {
    time: "20:30",
    eyebrow: t("Chapter 2 · The rush", "Capítulo 2 · O pico"),
    title: t("Every ticket,", "Cada pedido,"),
    accent: t("straight to the line.", "direto para a cozinha."),
    lead: t(
      "Ring it up at the POS and it appears on the kitchen display. The line moves it from new to ready while the floor sees what's coming.",
      "Lance no caixa e ele aparece na tela da cozinha. A equipe move o pedido de novo para pronto enquanto o salão acompanha o que vem.",
    ),
  };
  return (
    <FilmScene id="chapter-rush" frames={RUSH} poster="/frames/pico/d/001.webp" height={340} label={t("Chapter 2: the rush", "Capítulo 2: o pico")}>
      {(p) => (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[rgb(7_12_21/0.6)] lg:bg-[linear-gradient(90deg,rgb(7_12_21/0.92)_0%,rgb(7_12_21/0.55)_45%,rgb(7_12_21/0.35)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#070c15_0%,transparent_18%,transparent_82%,#070c15_100%)]" />
          <ChapterStage
            p={p}
            cardSide="right"
            card={(cp) => <OrderFlow p={cp} />}
            text={<ChapterText copy={copy} category={category} limit={3} />}
          />
        </>
      )}
    </FilmScene>
  );
}

/* ------------------------------------------------------------ Chapter 3 · Close */

function ChapterClose({ category }: { category: FeatureCategory }) {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const copy: ChapterCopy = {
    time: "23:30",
    eyebrow: t("Chapter 3 · Closing", "Capítulo 3 · O fechamento"),
    title: t("Lights down.", "Luzes apagadas."),
    accent: t("The numbers add up.", "Os números fecham."),
    lead: t(
      "Sales, expenses and stock movements from the night are already in Finance. Reports export to CSV, Excel or PDF.",
      "Vendas, despesas e movimentações de estoque da noite já estão no Financeiro. Os relatórios saem em CSV, Excel ou PDF.",
    ),
  };
  return (
    <FilmScene
      id="chapter-close"
      frames={CLOSE}
      poster="/frames/fechamento/d/001.webp"
      height={340}
      label={t("Chapter 3: closing", "Capítulo 3: o fechamento")}
    >
      {(p) => (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[rgb(7_12_21/0.6)] lg:bg-[linear-gradient(270deg,rgb(7_12_21/0.92)_0%,rgb(7_12_21/0.55)_50%,rgb(7_12_21/0.3)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#070c15_0%,transparent_18%,transparent_82%,#070c15_100%)]" />
          <ChapterStage
            p={p}
            cardSide="left"
            card={(cp) => <RevenueChart p={cp} />}
            text={<ChapterText copy={copy} category={category} />}
          />
        </>
      )}
    </FilmScene>
  );
}

/* ------------------------------------------------------------- Night timeline */

const RAIL = [
  { id: "chapter-prep", time: "18:00" },
  { id: "chapter-rush", time: "20:30" },
  { id: "chapter-close", time: "23:30" },
];

/** Fixed timeline on wide screens: shows where in the night the visitor is. */
function NightRail() {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const onScroll = () => {
      const mid = window.innerHeight / 2;
      let next = -1;
      RAIL.forEach((r, i) => {
        const rect = document.getElementById(r.id)?.getBoundingClientRect();
        if (rect && rect.top <= mid && rect.bottom > mid) next = i;
      });
      setActive(next);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      aria-hidden
      className={cx(
        "pointer-events-none fixed top-1/2 right-5 z-30 hidden -translate-y-1/2 flex-col items-end gap-5 transition-opacity duration-500 min-[1600px]:flex",
        active >= 0 ? "opacity-100" : "opacity-0",
      )}
    >
      {RAIL.map((r, i) => (
        <div key={r.id} className="flex items-center gap-3">
          <span
            className={cx(
              "text-xs font-semibold tabular-nums transition-colors duration-300",
              i === active ? "text-emerald" : i < active ? "text-offwhite/60" : "text-mist/35",
            )}
          >
            {r.time}
          </span>
          <span className={cx("block h-px transition-all duration-500", i === active ? "w-10 bg-emerald" : "w-5 bg-mist/30")} />
        </div>
      ))}
    </div>
  );
}

/** The three chapters of one service night (anchor #features for the main navigation). */
export function NightStory() {
  const { locale } = useLocale();
  const categories = getFeatureCategories(locale);
  const byId = (id: string) => categories.find((c) => c.id === id)!;
  return (
    <div id="features">
      <NightRail />
      <ChapterPrep category={byId("inventory")} />
      <ChapterRush category={byId("operations")} />
      <ChapterClose category={byId("finance")} />
    </div>
  );
}
