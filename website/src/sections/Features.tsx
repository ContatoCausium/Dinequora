import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { getFeatureCategories } from "../content/features";
import { cx, Reveal, SectionHeader, StatusBadge } from "../components/ui";
import { PauseButton, RotateProgress, useAutoRotate } from "../components/autoRotate";
import { pick, useLocale } from "../i18n/locale";

export function Features() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const featureCategories = getFeatureCategories(locale);
  const { active, select: setActive, next, running, userPaused, togglePause, bind } = useAutoRotate(featureCategories.length);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const list = useRef<HTMLDivElement>(null);

  // On small screens the tabs scroll sideways: keep the active one in view as slides change.
  useEffect(() => {
    const el = list.current;
    const tab = tabs.current[active];
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: tab.offsetLeft - 20, behavior: "smooth" });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = featureCategories.length;
    let target: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") target = (active + 1) % count;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") target = (active - 1 + count) % count;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = count - 1;
    else return;
    e.preventDefault();
    setActive(target);
    tabs.current[target]?.focus();
  };

  return (
    <section id="features" aria-labelledby="features-title" className="relative bg-navy-950 py-24 sm:py-32">
      <div className="container-page">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeader
            id="features-title"
            eyebrow={t("Product features", "Recursos do produto")}
            title={
              <>
                {t("The complete restaurant ", "A gestão completa do ")}
                <span className="accent-serif text-emerald">{t("back office.", "restaurante.")}</span>
              </>
            }
            lead={t(
              "Five connected modules, one login. Every capability below is labeled with its current availability, so you know exactly what you get on day one.",
              "Cinco módulos conectados, um único login. Cada recurso abaixo mostra sua disponibilidade atual, para você saber exatamente o que recebe no primeiro dia.",
            )}
          />
          <Reveal className="flex shrink-0 items-center gap-4 text-sm text-mist">
            <StatusBadge status="available" /> {t("In the product today", "Já no produto")}
            <StatusBadge status="rollingOut" /> {t("Partially built", "Parcialmente pronto")}
          </Reveal>
        </div>

        <Reveal className="mt-14">
          <div {...bind} className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
            <div className="flex min-w-0 flex-col gap-3">
              <div
                ref={list}
                role="tablist"
                aria-label={t("Feature categories", "Categorias de recursos")}
                aria-orientation="vertical"
                onKeyDown={onKeyDown}
                className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:flex-col lg:overflow-visible lg:pb-0"
              >
                {featureCategories.map((c, i) => {
                  const CIcon = c.icon;
                  const selected = i === active;
                  return (
                    <button
                      key={c.id}
                      ref={(el) => {
                        tabs.current[i] = el;
                      }}
                      role="tab"
                      type="button"
                      id={`feature-tab-${c.id}`}
                      aria-selected={selected}
                      aria-controls={`feature-panel-${c.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActive(i)}
                      className={cx(
                        "group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-4 py-3.5 text-left transition-all duration-300 lg:w-full",
                        selected
                          ? "border-emerald/40 bg-emerald/[0.08] text-offwhite"
                          : "border-line-dark text-mist hover:border-mist/25 hover:text-offwhite",
                      )}
                    >
                      <CIcon aria-hidden className={cx("size-[18px] shrink-0", selected ? "text-emerald" : "text-mist/70")} strokeWidth={1.75} />
                      <span className="text-[0.95rem] font-medium whitespace-nowrap">{c.title}</span>
                      <span className="ml-auto hidden text-xs text-mist/50 tabular-nums lg:inline">
                        {String(c.capabilities.length).padStart(2, "0")}
                      </span>
                      {selected && (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald/10">
                          <RotateProgress key={`${c.id}-${active}`} running={running} onDone={next} className="bg-emerald" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 text-xs text-mist/70">
                <PauseButton paused={userPaused} onToggle={togglePause} />
                <span>
                  {userPaused ? t("Rotation paused", "Rotação pausada") : t("Rotates automatically", "Troca automaticamente")}
                  {!userPaused && (
                    <span className="hidden lg:inline">{t(" · hover to pause", " · passe o mouse para pausar")}</span>
                  )}
                </span>
              </div>
            </div>

            {/* All panels share one grid cell: the box keeps the tallest height and slides crossfade without layout jumps. */}
            <div className="grid grid-cols-[minmax(0,1fr)]">
              {featureCategories.map((category, idx) => {
                const isActive = idx === active;
                const Icon = category.icon;
                return (
                  <div
                    key={category.id}
                    id={`feature-panel-${category.id}`}
                    role="tabpanel"
                    aria-labelledby={`feature-tab-${category.id}`}
                    aria-hidden={!isActive}
                    inert={!isActive}
                    className={cx(
                      "surface-dark overflow-hidden rounded-3xl transition-opacity duration-700 [grid-area:1/1]",
                      isActive ? "opacity-100" : "invisible opacity-0",
                    )}
                  >
                    <div className="relative h-48 overflow-hidden sm:h-64">
                      <img
                        src={category.image.src}
                        alt={category.image.alt}
                        loading="lazy"
                        decoding="async"
                        style={{ objectPosition: category.image.position }}
                        className={cx("absolute inset-0 h-full w-full object-cover", isActive && "kenburns")}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#101a2c] via-[#101a2c]/30 to-transparent" aria-hidden />
                    </div>
                    <div className="relative -mt-14 p-7 pt-0 sm:-mt-16 sm:p-10 sm:pt-0">
                      <div className={cx("flex items-center gap-3", isActive && "rise")}>
                        <span className="grid size-10 place-items-center rounded-xl bg-navy-900/80 text-emerald ring-1 ring-emerald/25 backdrop-blur">
                          <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                        </span>
                        <p className="eyebrow text-offwhite/80">{category.kicker}</p>
                      </div>
                      <h3
                        className={cx("heading mt-6 text-2xl text-offwhite sm:text-3xl", isActive && "rise")}
                        style={{ "--rise-delay": "60ms" } as CSSProperties}
                      >
                        {category.title}
                      </h3>
                      <p
                        className={cx("mt-3 max-w-xl leading-relaxed text-mist", isActive && "rise")}
                        style={{ "--rise-delay": "100ms" } as CSSProperties}
                      >
                        {category.summary}
                      </p>
                      <ul className="mt-8 grid border-t border-line-dark md:grid-cols-2 md:gap-x-10">
                        {category.capabilities.map((cap, i) => (
                          <li
                            key={cap.name}
                            className={cx("flex flex-col gap-2 border-b border-line-dark py-5", isActive && "rise")}
                            style={{ "--rise-delay": `${140 + i * 50}ms` } as CSSProperties}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <h4 className="font-medium text-offwhite">{cap.name}</h4>
                              <StatusBadge status={cap.status} />
                            </div>
                            <p className="text-sm leading-relaxed text-mist">{cap.detail}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
