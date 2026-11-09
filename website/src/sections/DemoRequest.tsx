import { useId, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Info, Loader2, ShieldCheck } from "lucide-react";
import { DEMO_REQUEST_ENDPOINT, whatsappUrl } from "../config/site";
import {
  buildWhatsAppMessage,
  emptyDemoRequest,
  locationOptions,
  optionLabel,
  roleOptions,
  submitDemoRequest,
  submitErrorMessage,
  validateDemoRequest,
  type DemoRequest as DemoRequestData,
  type DemoRequestErrors,
  type SubmitResult,
} from "../lib/demoRequest";
import { cx, Reveal } from "../components/ui";
import { WhatsAppIcon } from "../components/whatsapp";
import { pick, useLocale } from "../i18n/locale";

type FieldProps = {
  label: string;
  name: keyof DemoRequestData;
  error?: string | undefined;
  optional?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
};

function Field({ label, name, error, optional, children }: FieldProps) {
  const { locale } = useLocale();
  const base = useId();
  const id = `${base}-${name}`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-baseline justify-between text-sm font-medium text-offwhite">
        {label}
        {optional && <span className="text-xs font-normal text-mist/70">{pick(locale, "Optional", "Opcional")}</span>}
      </label>
      {children(error ? { id, "aria-invalid": true, "aria-describedby": errorId } : { id, "aria-invalid": false })}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-300">
          <AlertCircle aria-hidden className="size-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "block w-full rounded-xl border border-line-dark bg-navy-950/70 px-4 py-3 text-[0.95rem] text-offwhite placeholder:text-mist/45 transition-colors focus:border-emerald/60 focus:bg-navy-950 focus:outline-none aria-[invalid=true]:border-rose-400/70";

export function DemoRequest() {
  const { locale } = useLocale();
  const t = <T,>(en: T, pt: T) => pick(locale, en, pt);
  const [values, setValues] = useState<DemoRequestData>(emptyDemoRequest);
  // Fields flagged at the last submit; messages are derived so they follow the active language.
  const [flagged, setFlagged] = useState<ReadonlySet<keyof DemoRequestData>>(new Set());
  const current = validateDemoRequest(values, locale);
  const errors: DemoRequestErrors = Object.fromEntries(
    [...flagged].filter((k) => current[k]).map((k) => [k, current[k]]),
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const update =
    (key: keyof DemoRequestData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setValues((v) => ({ ...v, [key]: value }));
      if (flagged.has(key))
        setFlagged((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
    };

  // Without a form backend, the request is handed to WhatsApp, where the visitor sends it.
  const viaWhatsApp = DEMO_REQUEST_ENDPOINT === null;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResult(null);
    const found = validateDemoRequest(values, locale);
    setFlagged(new Set(Object.keys(found) as Array<keyof DemoRequestData>));
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    if (honeypot) {
      // Likely automated submission: silently drop it.
      return;
    }
    if (viaWhatsApp) {
      // Opened synchronously inside the submit handler so pop-up blockers allow it.
      const url = whatsappUrl(buildWhatsAppMessage(values, locale));
      window.open(url, "_blank", "noopener,noreferrer");
      setResult({ status: "whatsapp", url });
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    setSubmitting(true);
    const res = await submitDemoRequest(values, DEMO_REQUEST_ENDPOINT, fetch, locale);
    setSubmitting(false);
    setResult(res);
    if (res.status === "sent") setValues(emptyDemoRequest);
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  return (
    <section id="demo" aria-labelledby="demo-title" className="relative isolate overflow-hidden bg-navy-950 py-24 sm:py-32">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <img
          src="/images/plating-line.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-y-0 right-0 h-full w-full object-cover opacity-[0.08] lg:opacity-[0.16] [mask-image:linear-gradient(90deg,transparent_25%,black)] lg:w-2/3"
        />
        <div className="grid-cells absolute inset-0" />
        {/* A few cells of the grid light up slowly (56px grid). */}
        {[
          [3, 2, "0s"],
          [7, 5, "2.4s"],
          [11, 1, "4.1s"],
          [5, 8, "1.2s"],
          [14, 6, "5.3s"],
          [9, 10, "3.2s"],
        ].map(([col, row, delay]) => (
          <span
            key={`${col}-${row}`}
            className="cell-glow absolute size-[55px] bg-emerald/[0.07] shadow-[inset_0_0_0_1px_rgb(16_185_129/0.18)]"
            style={{ left: `${Number(col) * 56 + 1}px`, top: `${Number(row) * 56 + 1}px`, "--cell-delay": delay } as CSSProperties}
          />
        ))}
        <div className="absolute -top-40 left-[10%] size-[620px] rounded-full bg-[radial-gradient(circle,rgb(16_185_129/0.16),transparent_65%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#070C15,transparent_18%,transparent_82%,#070C15)]" />
      </div>

      <div className="container-page relative grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
        <Reveal className="lg:pt-6">
          <p className="eyebrow text-emerald">
            <span aria-hidden className="h-px w-6 bg-emerald/70" />
            {t("Talk to sales", "Fale com o comercial")}
          </p>
          <h2 id="demo-title" className="display mt-6 text-[2.6rem] text-offwhite sm:text-6xl">
            {t("See Dinequora run ", "Veja o Dinequora no ")}
            <span className="accent-serif text-emerald">{t("your", "seu")}</span>
            {t(" restaurant.", " restaurante.")}
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-mist">
            {t(
              "A guided walkthrough with our team, built around your menu, your locations, and the way your service runs.",
              "Uma apresentação guiada com a nossa equipe, montada em torno do seu cardápio, das suas unidades e do jeito que o seu serviço funciona.",
            )}
          </p>
          <p className="mt-10 text-xs font-semibold tracking-[0.16em] text-mist/70 uppercase">
            {t("In your demo", "Na sua demonstração")}
          </p>
          <ul className="mt-4 space-y-4 text-[0.98rem] text-offwhite/90">
            {t(
              [
                "A live tour of the POS, kitchen display, inventory, and finance",
                "An honest look at what's available today and what's rolling out",
                "A clear quote: implementation fee plus monthly subscription",
              ],
              [
                "Um tour ao vivo pelo PDV, tela da cozinha, estoque e financeiro",
                "Uma visão honesta do que já está disponível e do que ainda está sendo liberado",
                "Um orçamento claro: taxa de implantação mais assinatura mensal",
              ],
            ).map((item) => (
              <li key={item} className="flex gap-3">
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald" strokeWidth={1.75} />
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120}>
          <form
            ref={formRef}
            noValidate
            onSubmit={onSubmit}
            aria-labelledby="demo-title"
            className="relative rounded-3xl border border-line-dark bg-navy-900/85 p-6 shadow-[0_40px_100px_-40px_rgb(0_0_0/0.9)] backdrop-blur-xl sm:p-9"
          >
            <div aria-hidden className="absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-emerald/70 to-transparent" />
            <div className="mb-7 flex items-start justify-between gap-4 border-b border-line-dark pb-6">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-offwhite">{t("Request a demo", "Solicite sua demonstração")}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-mist">
                  {viaWhatsApp
                    ? t(
                        "Fill in your details and we'll open WhatsApp with your request ready to send.",
                        "Preencha seus dados e abrimos o WhatsApp com a sua solicitação pronta para enviar.",
                      )
                    : t("Fill in your details and our team will contact you.", "Preencha seus dados e nossa equipe entra em contato.")}
                </p>
              </div>
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-mist ring-1 ring-white/10 sm:inline-flex lg:hidden xl:inline-flex">
                <ShieldCheck aria-hidden className="size-3.5 text-emerald" /> {t("No commitment", "Sem compromisso")}
              </span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("Full name", "Nome completo")} name="name" error={errors.name}>
                {(p) => <input {...p} name="name" autoComplete="name" value={values.name} onChange={update("name")} className={inputClass} />}
              </Field>
              <Field label={t("Work email", "E-mail profissional")} name="email" error={errors.email}>
                {(p) => (
                  <input {...p} name="email" type="email" autoComplete="email" value={values.email} onChange={update("email")} className={inputClass} />
                )}
              </Field>
              <Field label={t("Restaurant or group", "Restaurante ou grupo")} name="restaurant" error={errors.restaurant}>
                {(p) => (
                  <input {...p} name="restaurant" autoComplete="organization" value={values.restaurant} onChange={update("restaurant")} className={inputClass} />
                )}
              </Field>
              <Field label={t("Phone", "WhatsApp")} name="phone" error={errors.phone} optional>
                {(p) => (
                  <input
                    {...p}
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 555-0123"
                    value={values.phone}
                    onChange={update("phone")}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label={t("Number of locations", "Número de unidades")} name="locations" error={errors.locations}>
                {(p) => (
                  <select {...p} name="locations" value={values.locations} onChange={update("locations")} className={cx(inputClass, "appearance-none")}>
                    <option value="" disabled>
                      {t("Select…", "Selecione…")}
                    </option>
                    {locationOptions.map((o) => (
                      <option key={o} value={o}>
                        {optionLabel(o, locale)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("Your role", "Sua função")} name="role" error={errors.role}>
                {(p) => (
                  <select {...p} name="role" value={values.role} onChange={update("role")} className={cx(inputClass, "appearance-none")}>
                    <option value="" disabled>
                      {t("Select…", "Selecione…")}
                    </option>
                    {roleOptions.map((o) => (
                      <option key={o} value={o}>
                        {optionLabel(o, locale)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field label={t("What would you like to see?", "O que você gostaria de ver?")} name="message" error={errors.message} optional>
                  {(p) => (
                    <textarea
                      {...p}
                      name="message"
                      rows={4}
                      maxLength={2000}
                      value={values.message}
                      onChange={update("message")}
                      className={cx(inputClass, "resize-y")}
                    />
                  )}
                </Field>
              </div>
            </div>

            {/* Honeypot: hidden from people and assistive tech. */}
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
              <label>
                Company website
                <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </label>
            </div>

            <div className="mt-6">
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-mist">
                <input
                  type="checkbox"
                  name="consent"
                  checked={values.consent}
                  onChange={update("consent")}
                  aria-invalid={Boolean(errors.consent)}
                  aria-describedby={errors.consent ? "consent-error" : undefined}
                  className="mt-1 size-4 shrink-0 accent-emerald"
                />
                {t(
                  "I agree that Dinequora may contact me about this demo request.",
                  "Concordo que o Dinequora entre em contato comigo sobre esta solicitação de demonstração.",
                )}
              </label>
              {errors.consent && (
                <p id="consent-error" className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-300">
                  <AlertCircle aria-hidden className="size-3.5" /> {errors.consent}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-7 inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-full bg-emerald px-6 font-semibold text-navy shadow-[0_0_0_1px_rgb(16_185_129/0.4),0_14px_40px_-12px_rgb(16_185_129/0.7)] transition-colors hover:bg-emerald-soft disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" /> {t("Sending request…", "Enviando solicitação…")}
                </>
              ) : viaWhatsApp ? (
                <>
                  <WhatsAppIcon className="size-5" />
                  {t("Continue on WhatsApp", "Continuar no WhatsApp")}
                </>
              ) : (
                t("Request my demo", "Solicitar minha demonstração")
              )}
            </button>
            {viaWhatsApp && (
              <p className="mt-3 text-center text-xs leading-relaxed text-mist/75">
                {t(
                  "WhatsApp opens with your request filled in. Nothing is sent until you tap send there.",
                  "O WhatsApp abre com a sua solicitação preenchida. Nada é enviado até você tocar em enviar.",
                )}
              </p>
            )}

            <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
              {result?.status === "sent" && (
                <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald/30 bg-emerald/10 p-4 text-sm text-offwhite">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald" />
                  {t(
                    "Thank you. Your request was received and our team will contact you to schedule your demo.",
                    "Obrigado. Sua solicitação foi recebida e nossa equipe vai entrar em contato para agendar a demonstração.",
                  )}
                </p>
              )}
              {result?.status === "whatsapp" && (
                <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald/30 bg-emerald/10 p-4 text-sm text-offwhite">
                  <WhatsAppIcon className="mt-0.5 size-4 shrink-0 text-emerald" />
                  <span>
                    <strong className="font-semibold">{t("Almost there.", "Quase lá.")}</strong>{" "}
                    {t(
                      "We opened WhatsApp in a new tab with your request. Tap send there to reach our sales team.",
                      "Abrimos o WhatsApp em uma nova aba com a sua solicitação. Toque em enviar lá para falar com o comercial.",
                    )}{" "}
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald underline-offset-4 hover:underline">
                      {t("Didn't open? Open WhatsApp", "Não abriu? Abrir o WhatsApp")}
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  </span>
                </p>
              )}
              {result?.status === "not-configured" && (
                <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-offwhite">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-amber" />
                  <span>
                    <strong className="font-semibold">{t("Your request was not sent.", "Sua solicitação não foi enviada.")}</strong>{" "}
                    {t(
                      "Online demo requests are not connected yet on this version of the site. Your details were checked but not stored or delivered anywhere.",
                      "As solicitações de demonstração on-line ainda não estão conectadas nesta versão do site. Seus dados foram conferidos, mas não foram guardados nem enviados para lugar nenhum.",
                    )}
                  </span>
                </p>
              )}
              {result?.status === "error" && (
                <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-offwhite">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  <span>
                    <strong className="font-semibold">{t("Your request was not sent.", "Sua solicitação não foi enviada.")}</strong>{" "}
                    {submitErrorMessage(result, locale)} {t("Please try again in a moment.", "Tente novamente em instantes.")}
                  </span>
                </p>
              )}
            </div>
          </form>
        </Reveal>
      </div>
    </section>
  );
}
