/**
 * Observability foundation (Phase 0): structured logs, error capture with tenant/store scope,
 * sensitive-data redaction and critical-error alerting.
 *
 * - Every event is one JSON line (`{"ts","level","event","scope",...}`) on the console: the
 *   server's stdout is the log pipeline; in the browser it shows in DevTools and Lovable's hooks.
 * - Scope (org, location, member role, user id) is attached automatically once the workspace
 *   registers it. No names, e-mails or other profile data are attached.
 * - Redaction runs on every payload: secret-looking keys (password, token, authorization,
 *   apikey, secret, cookie, card/cvv/pan, ssn, ...) are replaced, and JWTs, bearer tokens,
 *   API keys, card numbers (Luhn-checked) and e-mail addresses inside strings are masked.
 * - Critical errors go to registered alert sinks (none by default: no data leaves the process
 *   until an operator wires a provider), de-duplicated per fingerprint per window.
 */

/** Message + stack + cause chain (side-effect free; error-capture.ts patches console on import). */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (!(current instanceof Error)) {
      let s: string;
      try {
        s = typeof current === "string" ? current : (JSON.stringify(current) ?? String(current));
      } catch {
        s = String(current);
      }
      parts.push(s);
      break;
    }
    const status =
      (current as { status?: unknown }).status ?? (current as { statusCode?: unknown }).statusCode;
    parts.push(
      `${depth ? "caused by: " : ""}${current.stack ?? `${current.name}: ${current.message}`}${typeof status === "number" ? ` (status ${status})` : ""}`,
    );
    current = current.cause;
  }
  return parts.join("\n").slice(0, 8000);
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
export type ObservabilityScope = {
  orgId?: string | null;
  locationId?: string | null;
  userId?: string | null;
  role?: string | null;
};
export type LogRecord = {
  ts: string;
  level: LogLevel;
  event: string;
  runtime: "server" | "browser";
  scope: ObservabilityScope;
  data?: unknown;
  error?: { message: string; detail: string; fingerprint: string };
};
export type AlertSink = (record: LogRecord) => void | Promise<void>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|auth_?header|api_?key|apikey|cookie|session_?id|jwt|bearer|private_?key|signature|card|cvv|cvc|pan\b|iban|account_?number|routing|ssn|tax_?id/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const API_KEY =
  /\b(sb_(secret|publishable)_[A-Za-z0-9_-]{8,}|sk_(live|test)_[A-Za-z0-9]{8,}|rk_(live|test)_[A-Za-z0-9]{8,})\b/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const URL_SECRET_PARAM =
  /([?&#](?:access_token|refresh_token|token|code|apikey|key|password)=)[^&#\s]+/gi;

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Masks secrets and personal data inside free text (messages, stacks, URLs). */
export function redactString(input: string): string {
  return input
    .replace(JWT, "[REDACTED_JWT]")
    .replace(BEARER, "$1 [REDACTED]")
    .replace(API_KEY, "[REDACTED_KEY]")
    .replace(URL_SECRET_PARAM, `$1${REDACTED}`)
    .replace(CARD_CANDIDATE, (m) => {
      const d = m.replace(/[ -]/g, "");
      return d.length >= 13 && d.length <= 19 && luhn(d) ? "[REDACTED_CARD]" : m;
    })
    .replace(EMAIL, "$1***@$2");
}

/** Deep copy with sensitive keys removed and strings masked. Safe on cycles and huge inputs. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string")
    return redactString(value.length > 4000 ? value.slice(0, 4000) + "…" : value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (depth > 6) return "[Truncated]";
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, 100)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

// ---------------------------------------------------------------- scope
let currentScope: ObservabilityScope = {};
/** Called by the workspace when org / store / member changes. Pass {} on sign-out. */
export function setObservabilityScope(scope: ObservabilityScope): void {
  currentScope = { ...scope };
}
export const getObservabilityScope = (): ObservabilityScope => ({ ...currentScope });

// ---------------------------------------------------------------- sinks
const sinks = new Set<AlertSink>();
/** Registers an alert destination for critical errors; returns an unregister function. */
export function registerAlertSink(sink: AlertSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/**
 * Exception reporters receive every captured error (level error/critical), already redacted and
 * scoped — the integration point for an exception-tracking provider (e.g. a Sentry adapter).
 * None is registered by default.
 */
export type ErrorReporter = (record: LogRecord) => void | Promise<void>;
const reporters = new Set<ErrorReporter>();
export function registerErrorReporter(reporter: ErrorReporter): () => void {
  reporters.add(reporter);
  return () => reporters.delete(reporter);
}
async function report(record: LogRecord) {
  for (const r of reporters) {
    try {
      await r(record);
    } catch {
      /* a failing reporter must not break the app or other reporters */
    }
  }
}

const ALERT_WINDOW_MS = 5 * 60_000;
const lastAlert = new Map<string, number>();
let writer: (line: string, level: LogLevel) => void = (line, level) => {
  // Bypasses error-capture's console.error expansion: the line is already structured.
  const out = level === "error" || level === "critical" ? console.warn : console.log;
  out.call(console, line);
};
/** Test hook: replace where log lines are written. Returns the previous writer. */
export function setLogWriter(fn: typeof writer): typeof writer {
  const prev = writer;
  writer = fn;
  return prev;
}

const runtime = (): LogRecord["runtime"] => (typeof window === "undefined" ? "server" : "browser");

export function logEvent(level: LogLevel, event: string, data?: unknown): LogRecord {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    runtime: runtime(),
    scope: getObservabilityScope(),
    ...(data === undefined ? {} : { data: redact(data) }),
  };
  emit(record);
  return record;
}

function emit(record: LogRecord) {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ ...record, data: "[Unserializable]" });
  }
  try {
    writer(line, record.level);
  } catch {
    /* logging must never throw */
  }
  if (record.error && reporters.size > 0) void report(record);
  if (record.level === "critical") void alert(record);
}

async function alert(record: LogRecord) {
  const key = record.error?.fingerprint ?? record.event;
  const now = Date.now();
  const prev = lastAlert.get(key);
  if (prev !== undefined && now - prev < ALERT_WINDOW_MS) return;
  lastAlert.set(key, now);
  for (const sink of sinks) {
    try {
      await sink(record);
    } catch {
      /* a failing sink must not break the app or other sinks */
    }
  }
}

/** Stable short id for "the same error" (message + first stack frame, numbers/ids stripped). */
export function fingerprint(error: unknown): string {
  const msg = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  const frame = error instanceof Error ? (error.stack?.split("\n")[1] ?? "") : "";
  const basis = `${msg}|${frame}`
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\d+/g, "<n>");
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) h = Math.imul(h ^ basis.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Records a failure with scope and context. `critical` is for failures that break a core flow
 * (checkout, order persistence, server 500s, root error boundary).
 */
export function captureError(
  error: unknown,
  context: { event?: string; critical?: boolean; [k: string]: unknown } = {},
): LogRecord {
  const { event = "error.captured", critical = false, ...rest } = context;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "non-error thrown";
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level: critical ? "critical" : "error",
    event,
    runtime: runtime(),
    scope: getObservabilityScope(),
    ...(Object.keys(rest).length ? { data: redact(rest) } : {}),
    error: {
      message: redactString(message).slice(0, 500),
      detail: redactString(describeError(error)).slice(0, 4000),
      fingerprint: fingerprint(error),
    },
  };
  emit(record);
  return record;
}

/**
 * Business-rule rejections raised by the database on purpose (they are shown to the user and are
 * not incidents). Anything else failing in a core flow is treated as critical.
 */
const EXPECTED_BUSINESS_ERRORS =
  /\b(permission_denied|forbidden|insufficient_stock|subscription_inactive|org_suspended|idempotency_conflict|location_forbidden|simulation_forbidden|store_limit|invalid_[a-z_]+|[a-z_]+_required)\b/;
export function isExpectedBusinessError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return EXPECTED_BUSINESS_ERRORS.test(msg);
}

let globalHandlersInstalled = false;
/** Browser: structured capture of uncaught errors and unhandled rejections (idempotent). */
export function installBrowserErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;
  window.addEventListener("error", (e) =>
    captureError(e.error ?? e.message, { event: "browser.uncaught_error", source: e.filename }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    captureError(e.reason, { event: "browser.unhandled_rejection" }),
  );
}

/** Test-only reset of module state. */
export function __resetObservabilityForTests(): void {
  currentScope = {};
  sinks.clear();
  reporters.clear();
  lastAlert.clear();
}
