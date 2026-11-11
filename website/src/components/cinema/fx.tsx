import { useEffect, useRef, useState } from "react";
import { cx } from "../ui";
import { pick, useLocale } from "../../i18n/locale";

const reduced = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* -------------------------------------------------------------- Night clock */

const CHAPTERS = ["chapter-prep", "chapter-rush", "chapter-close"];
const START = 18 * 60; // 18:00
const END = 23 * 60 + 30; // 23:30

/** A digit that rolls to its value like a split-flap counter. */
function RollingDigit({ value }: { value: string }) {
  const n = Number(value);
  if (Number.isNaN(n)) return <span>{value}</span>;
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] overflow-hidden align-top">
      <span className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-out-quint" style={{ transform: `translateY(${-n}em)` }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="block h-[1em] text-center leading-none">
            {i}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Fixed clock that runs from 18:00 to 23:30 while the visitor scrolls through the night. */
export function NightClock() {
  const { locale } = useLocale();
  const [state, setState] = useState<{ minutes: number; visible: boolean }>({ minutes: START, visible: false });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const first = document.getElementById(CHAPTERS[0]!);
      const last = document.getElementById(CHAPTERS[CHAPTERS.length - 1]!);
      if (!first || !last) return;
      const a = first.getBoundingClientRect().top + window.scrollY;
      const b = last.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
      const y = window.scrollY;
      const f = Math.min(1, Math.max(0, (y - a) / Math.max(1, b - a)));
      const minutes = Math.round((START + f * (END - START)) / 5) * 5;
      const visible = y >= a - window.innerHeight * 0.3 && y <= b + window.innerHeight * 0.3;
      setState((s) => (s.minutes === minutes && s.visible === visible ? s : { minutes, visible }));
    };
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  const h = Math.floor(state.minutes / 60);
  const m = state.minutes % 60;
  const hh = locale === "pt" ? String(h).padStart(2, "0") : String(h > 12 ? h - 12 : h);
  const mm = String(m).padStart(2, "0");
  return (
    <div
      aria-hidden
      className={cx(
        "pointer-events-none fixed top-24 right-6 z-30 hidden text-right transition-[opacity,transform] duration-500 lg:block",
        state.visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <div className="text-[11px] font-semibold tracking-[0.2em] text-mist/70 uppercase">{pick(locale, "Tonight", "Hoje à noite")}</div>
      <div className="mt-1 flex items-baseline justify-end font-semibold text-offwhite tabular-nums" style={{ fontSize: "3.4rem", lineHeight: 1 }}>
        {hh.split("").map((d, i) => (
          <RollingDigit key={`h${i}`} value={d} />
        ))}
        <span className="live-blink px-0.5 text-emerald">:</span>
        {mm.split("").map((d, i) => (
          <RollingDigit key={`m${i}`} value={d} />
        ))}
        {locale === "en" && <span className="ml-2 text-[1.1rem] font-medium text-mist">PM</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Marquee */

/** A band of large words that drifts sideways and speeds up with the scroll. */
export function Marquee({ items, tone = "dark" }: { items: string[]; tone?: "dark" | "emerald" }) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced()) return;
    let x = 0;
    let last = window.scrollY;
    let boost = 0;
    let raf = 0;
    const loop = () => {
      const el = track.current;
      if (el) {
        const y = window.scrollY;
        boost = boost * 0.9 + Math.abs(y - last) * 0.08;
        last = y;
        x -= 0.6 + boost;
        const half = el.scrollWidth / 2;
        if (half > 0 && -x >= half) x += half;
        el.style.transform = `translate3d(${x}px,0,0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const row = [...items, ...items];
  return (
    <div
      aria-hidden
      className={cx("overflow-hidden py-7 select-none sm:py-10", tone === "emerald" ? "bg-emerald text-navy" : "border-y border-line-dark bg-navy-950 text-offwhite")}
    >
      <div ref={track} className="flex w-max items-center gap-10 whitespace-nowrap will-change-transform">
        {row.map((w, i) => (
          <span key={i} className="flex items-center gap-10 text-4xl font-semibold tracking-tight sm:text-6xl">
            {w}
            <span className={cx("inline-block size-3 rounded-full sm:size-4", tone === "emerald" ? "bg-navy" : "bg-emerald")} />
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Facts band */

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [still] = useState(reduced);
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run || still) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1400);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, to, still]);
  return <span className="tabular-nums">{still ? to : v}</span>;
}

/** Product facts (not business claims) that count up when they arrive. */
export function FactsBand() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setRun(true), io.disconnect()), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const facts = [
    { n: 5, label: t("connected modules behind one login", "módulos conectados num só login") },
    { n: 7, label: t("financial report types, ready at close", "tipos de relatório financeiro, prontos no fechamento") },
    { n: 3, label: t("export formats: CSV, Excel and PDF", "formatos de exportação: CSV, Excel e PDF") },
    { n: 50, label: t("locations on one account with Enterprise, subject to contract", "unidades numa só conta no Enterprise, conforme contrato") },
  ];
  return (
    <section aria-label={t("The product in numbers", "O produto em números")} className="bg-navy py-20 sm:py-28">
      <div ref={ref} className="container-page grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f, i) => (
          <div
            key={f.label}
            className={cx("transition-[opacity,transform] duration-700 ease-out-quint", run ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0")}
            style={{ transitionDelay: `${i * 90}ms` }}
          >
            <div className="display text-7xl text-offwhite sm:text-8xl">
              <CountUp to={f.n} run={run} />
            </div>
            <p className="mt-3 max-w-[24ch] text-mist">{f.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------- Pointer effect (magnet) */

/**
 * One listener for the whole page: buttons marked data-magnetic lean toward the pointer.
 * Off on touch and for reduced motion.
 */
export function PointerFx() {
  useEffect(() => {
    if (reduced() || (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)) return;
    const move = (e: PointerEvent) => {
      document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((b) => {
        const r = b.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < 140;
        b.style.transform = near ? `translate(${dx * 0.18}px, ${dy * 0.25}px)` : "";
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return null;
}
