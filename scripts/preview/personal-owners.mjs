// Personal owners of the client preview: at most TWO real people (their own e-mail addresses), each
// with an individual Supabase Auth account and the Owner role of the demo organization only — never a
// platform role. The addresses never live in this (public) repository: they come from
// PREVIEW_PERSONAL_OWNERS in the operator's secrets file, and on the hosted preview they are fixed in
// dq_preview.personal_accounts when the database is marked (scripts/preview/sql/client-preview-identity.sql).
// Logs never print them: personal owners are shown as "personal owner 1/2".
import { EMAIL_DOMAIN } from "./dataset.mjs";

export const MAX_PERSONAL_OWNERS = 2;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const RESERVED_TEST = /\.(test|example|invalid|localhost)$/;

export class PersonalOwnersError extends Error {
  constructor(message) {
    super(`refused by the personal-owner rules: ${message}`);
    this.name = "PersonalOwnersError";
  }
}

/** Reserved test addresses (the demo accounts, RFC 6761/2606 TLDs) are never personal. */
export const isReservedTestEmail = (email) => RESERVED_TEST.test(String(email ?? "").toLowerCase());

/**
 * Parses PREVIEW_PERSONAL_OWNERS (comma-separated). Returns the addresses lower-cased and sorted.
 * Refuses more than two, duplicates, malformed addresses and the demo domain, and:
 *   hosted (default): reserved test domains — the hosted preview's personal owners are real people;
 *   local: anything BUT a reserved test domain — real people never enter a local stack (its target
 *          guard treats a database with real accounts as no longer disposable), so a rehearsal uses
 *          stand-in addresses such as first.owner@personal.test.
 * Error messages never repeat an address.
 */
export function parsePersonalOwners(raw, { mode = "hosted" } = {}) {
  if (mode !== "hosted" && mode !== "local") throw new PersonalOwnersError("unknown mode");
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length > MAX_PERSONAL_OWNERS)
    throw new PersonalOwnersError(
      `at most ${MAX_PERSONAL_OWNERS} personal owners (got ${list.length})`,
    );
  if (new Set(list).size !== list.length) throw new PersonalOwnersError("duplicate address");
  list.forEach((e, i) => {
    if (!EMAIL.test(e)) throw new PersonalOwnersError(`address #${i + 1} is not an e-mail address`);
    if (e.endsWith(`@${EMAIL_DOMAIN}`))
      throw new PersonalOwnersError(`address #${i + 1} is in the demo-account domain`);
    if (mode === "hosted" && isReservedTestEmail(e))
      throw new PersonalOwnersError(`address #${i + 1} is a reserved test address, not a person`);
    if (mode === "local" && !isReservedTestEmail(e))
      throw new PersonalOwnersError(
        `address #${i + 1} is a real address: a local stack takes stand-in .test addresses only`,
      );
  });
  return Object.freeze([...list].sort());
}

export const sameOwners = (a, b) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** "personal owner 1/2" — the label used in every log line instead of the address. */
export const personalLabel = (owners, email) =>
  `personal owner ${owners.indexOf(String(email).toLowerCase()) + 1}/${owners.length}`;
