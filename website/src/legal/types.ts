import type { CompanyFacts } from "../config/company";

/**
 * A legal page as data, so the English and Portuguese versions share one layout and a company
 * fact (name, state, e-mail, address, date) is always read from config/company.ts, never typed
 * into the text.
 */
export type Inline =
  | string
  | { fact: keyof CompanyFacts }
  | { strong: string }
  | { href: string; label: string; external?: boolean };

export type Block = { p: Inline[] } | { ul: Inline[][] };

export type LegalSection = { id: string; heading: string; blocks: Block[] };

export type LegalDocument = {
  title: string;
  /** Short line under the title. */
  lead: string;
  sections: LegalSection[];
};
