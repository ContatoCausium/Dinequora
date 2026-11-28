type Copy = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta?: string;
  footer: string;
};
type Template = { action: string | null; en: Copy; pt: Copy };

export const OUT_DIR: string;
export const LANG: string;
export const LOGO_URL: string;
export const TEMPLATES: {
  confirmation: Template;
  recovery: Template;
  magic_link: Template;
  email_change: Template;
  invite: Template;
  reauthentication: Template;
};
export function subjectTemplate(t: Template): string;
export function htmlTemplate(t: Template): string;
