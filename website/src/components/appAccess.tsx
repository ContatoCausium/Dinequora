/**
 * Login and sign-up while the restaurant application is not published (`appRoutes` is null).
 *
 * The action is rendered as plain text, not as a link or button: it has no destination, no
 * role, cannot receive focus and is not in the tab order. Screen readers read it as ordinary
 * text, "Login, coming soon" ("Entrar, em breve"); the comma is visually hidden and only gives
 * the pause. Nothing is redirected to the demo form.
 */
import { cx } from "./ui";
import { pick, useLocale } from "../i18n/locale";

/** Small pill that marks an action as not yet available (read aloud as part of the text). */
export function ComingSoonBadge({ className }: { className?: string }) {
  const { locale } = useLocale();
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tracking-wide whitespace-nowrap",
        "bg-mist/10 text-mist ring-1 ring-inset ring-mist/25",
        className,
      )}
    >
      {pick(locale, "Coming soon", "Em breve")}
    </span>
  );
}

/** "Login [Coming soon]": the action's name plus the badge, as non-interactive text. */
export function UnavailableAction({ label, className }: { label: string; className?: string }) {
  return (
    <span data-app-link="unavailable" className={cx("cursor-default items-center gap-2", className ?? "inline-flex")}>
      <span>{label}</span>
      <span className="sr-only">, </span>
      <ComingSoonBadge />
    </span>
  );
}
