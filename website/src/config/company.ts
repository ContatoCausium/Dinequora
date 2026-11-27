/**
 * Company facts used by the legal pages. Nothing here is guessed: a fact that the owner has not
 * given yet stays `null`, and the pages show a visible "[preencher: …]" marker in its place so a
 * missing fact can never pass for a real one. Fill these in (and remove the markers) before the
 * legal pages are published.
 */
export type CompanyFacts = {
  /** Legal name of the company, e.g. "Dinequora LLC". */
  legalName: string | null;
  /** US state where the company is organized, e.g. "Delaware". */
  stateOfOrganization: string | null;
  /** Address that receives privacy requests and general contact. */
  contactEmail: string | null;
  /** Mailing address of the company. */
  mailingAddress: string | null;
  /** Date the current version of the legal pages takes effect, e.g. "December 1, 2026". */
  effectiveDate: { en: string; pt: string } | null;
};

export const COMPANY: CompanyFacts = {
  legalName: null,
  stateOfOrganization: null,
  contactEmail: null,
  mailingAddress: null,
  effectiveDate: null,
};

/** The facts still missing, in the words of the visible markers (also listed in the PR). */
export const MISSING_FACT_LABELS: Record<keyof CompanyFacts, string> = {
  legalName: "nome legal da empresa",
  stateOfOrganization: "estado de registro da empresa",
  contactEmail: "e-mail de contato e de privacidade",
  mailingAddress: "endereço postal da empresa",
  effectiveDate: "data de vigência das páginas legais",
};

export function missingFacts(facts: CompanyFacts = COMPANY): Array<keyof CompanyFacts> {
  return (Object.keys(MISSING_FACT_LABELS) as Array<keyof CompanyFacts>).filter((key) => facts[key] === null);
}
