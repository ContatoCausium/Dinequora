/**
 * Demo request form: validation and submission.
 *
 * Submission only happens when VITE_DEMO_REQUEST_ENDPOINT is configured.
 * Without it, `submitDemoRequest` returns `{ status: "not-configured" }` and the
 * UI tells the visitor that nothing was sent. It never pretends delivery.
 */
import type { Locale } from "../i18n/locale";

export type DemoRequest = {
  name: string;
  email: string;
  restaurant: string;
  phone: string;
  locations: string;
  role: string;
  message: string;
  consent: boolean;
};

export type DemoRequestErrors = Partial<Record<keyof DemoRequest, string>>;

export const emptyDemoRequest: DemoRequest = {
  name: "",
  email: "",
  restaurant: "",
  phone: "",
  locations: "",
  role: "",
  message: "",
  consent: false,
};

/** Option values are stable English keys (sent to the backend); labels are translated. */
export const locationOptions = ["1 location", "2–3 locations", "4–10 locations", "11–50 locations", "More than 50"] as const;
export const roleOptions = ["Owner", "Operator / Partner", "General manager", "Finance / Back office", "Other"] as const;

const optionLabelsPt: Record<string, string> = {
  "1 location": "1 unidade",
  "2–3 locations": "2–3 unidades",
  "4–10 locations": "4–10 unidades",
  "11–50 locations": "11–50 unidades",
  "More than 50": "Mais de 50",
  Owner: "Dono(a)",
  "Operator / Partner": "Operador(a) / Sócio(a)",
  "General manager": "Gerente geral",
  "Finance / Back office": "Financeiro / Administrativo",
  Other: "Outro",
};

export function optionLabel(value: string, locale: Locale): string {
  return locale === "pt" ? (optionLabelsPt[value] ?? value) : value;
}

const messages = {
  en: {
    nameRequired: "Please enter your full name.",
    nameTooLong: "Name must be 120 characters or fewer.",
    emailRequired: "Please enter your work email.",
    emailInvalid: "Please enter a valid email address.",
    restaurantRequired: "Please enter your restaurant or group name.",
    restaurantTooLong: "Restaurant name must be 160 characters or fewer.",
    phoneInvalid: "Please enter a valid phone number, or leave it blank.",
    locations: "Please select how many locations you operate.",
    role: "Please select your role.",
    messageTooLong: "Message must be 2,000 characters or fewer.",
    consent: "Please confirm we may contact you about your demo request.",
  },
  pt: {
    nameRequired: "Informe seu nome completo.",
    nameTooLong: "O nome deve ter no máximo 120 caracteres.",
    emailRequired: "Informe seu e-mail profissional.",
    emailInvalid: "Informe um endereço de e-mail válido.",
    restaurantRequired: "Informe o nome do restaurante ou grupo.",
    restaurantTooLong: "O nome do restaurante deve ter no máximo 160 caracteres.",
    phoneInvalid: "Informe um telefone válido ou deixe o campo em branco.",
    locations: "Selecione quantas unidades você opera.",
    role: "Selecione sua função.",
    messageTooLong: "A mensagem deve ter no máximo 2.000 caracteres.",
    consent: "Confirme que podemos entrar em contato sobre sua solicitação de demonstração.",
  },
} satisfies Record<Locale, Record<string, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateDemoRequest(input: DemoRequest, locale: Locale = "en"): DemoRequestErrors {
  const m = messages[locale];
  const errors: DemoRequestErrors = {};
  const name = input.name.trim();
  const email = input.email.trim();
  const restaurant = input.restaurant.trim();
  const phone = input.phone.trim();

  if (name.length < 2) errors.name = m.nameRequired;
  else if (name.length > 120) errors.name = m.nameTooLong;

  if (!email) errors.email = m.emailRequired;
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.email = m.emailInvalid;

  if (restaurant.length < 2) errors.restaurant = m.restaurantRequired;
  else if (restaurant.length > 160) errors.restaurant = m.restaurantTooLong;

  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 10 || digits.length > 15) errors.phone = m.phoneInvalid;
  }

  if (!(locationOptions as readonly string[]).includes(input.locations)) errors.locations = m.locations;
  if (!(roleOptions as readonly string[]).includes(input.role)) errors.role = m.role;

  if (input.message.length > 2000) errors.message = m.messageTooLong;

  if (!input.consent) errors.consent = m.consent;

  return errors;
}

/**
 * Text for the WhatsApp hand-off used while no form backend is configured.
 * The visitor sees it pre-filled in WhatsApp and decides whether to send it.
 */
export function buildWhatsAppMessage(input: DemoRequest, locale: Locale): string {
  const pt = locale === "pt";
  const lines = [
    pt ? "Olá! Gostaria de agendar uma demonstração do Dinequora." : "Hi! I'd like to book a Dinequora demo.",
    "",
    `${pt ? "Nome" : "Name"}: ${input.name.trim()}`,
    `${pt ? "Restaurante" : "Restaurant"}: ${input.restaurant.trim()}`,
    `E-mail: ${input.email.trim()}`,
  ];
  if (input.phone.trim()) lines.push(`${pt ? "Telefone" : "Phone"}: ${input.phone.trim()}`);
  lines.push(`${pt ? "Unidades" : "Locations"}: ${optionLabel(input.locations, locale)}`);
  lines.push(`${pt ? "Função" : "Role"}: ${optionLabel(input.role, locale)}`);
  if (input.message.trim()) lines.push("", input.message.trim());
  return lines.join("\n");
}

export type SubmitResult =
  | { status: "sent" }
  | { status: "not-configured" }
  | { status: "whatsapp"; url: string }
  | { status: "error"; reason: "http"; httpStatus: number }
  | { status: "error"; reason: "timeout" | "network" };

export function submitErrorMessage(result: Extract<SubmitResult, { status: "error" }>, locale: Locale): string {
  if (result.reason === "http")
    return locale === "pt"
      ? `O servidor respondeu com o status ${result.httpStatus}.`
      : `The server responded with status ${result.httpStatus}.`;
  if (result.reason === "timeout") return locale === "pt" ? "A solicitação demorou demais." : "The request timed out.";
  return locale === "pt" ? "Não foi possível falar com o servidor." : "We couldn't reach the server.";
}

export async function submitDemoRequest(
  input: DemoRequest,
  endpoint: string | null,
  fetcher: typeof fetch = fetch,
  locale: Locale = "en",
): Promise<SubmitResult> {
  if (!endpoint) return { status: "not-configured" };

  const payload = {
    name: input.name.trim(),
    email: input.email.trim(),
    restaurant: input.restaurant.trim(),
    phone: input.phone.trim() || null,
    locations: input.locations,
    role: input.role,
    message: input.message.trim() || null,
    consent: input.consent,
    language: locale,
    source: "dinequora-website",
    submittedAt: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return { status: "error", reason: "http", httpStatus: res.status };
    return { status: "sent" };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return { status: "error", reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
