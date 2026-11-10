/**
 * Login and sign-up while the restaurant application is not published (`appRoutes` is null):
 * the actions are shown as unavailable, never as links, so no visitor is sent to an address
 * that does not exist yet and nothing is redirected to the demo form.
 */
import { cx } from "./ui";
import { pick, useLocale } from "../i18n/locale";

export function useComingSoonLabels() {
  const { locale } = useLocale();
  return {
    soon: pick(locale, "Coming soon", "Em breve"),
    loginSoon: pick(locale, "Login — coming soon", "Entrar — em breve"),
    signupSoon: pick(locale, "Create account — coming soon", "Criar conta — em breve"),
  };
}

/** Small pill that marks an action as not yet available. */
export function ComingSoonBadge({ className }: { className?: string }) {
  const { soon } = useComingSoonLabels();
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tracking-wide",
        "bg-mist/10 text-mist ring-1 ring-inset ring-mist/25",
        className,
      )}
    >
      {soon}
    </span>
  );
}

/**
 * An action that is not available yet: plain text, marked disabled for assistive technology,
 * with the full sentence ("Login — coming soon") as its accessible name.
 */
export function UnavailableAction({
  label,
  accessibleName,
  className,
  badge = true,
}: {
  label: string;
  accessibleName: string;
  className?: string;
  badge?: boolean;
}) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-label={accessibleName}
      title={accessibleName}
      data-app-link="unavailable"
      className={cx("cursor-default items-center gap-2", className ?? "inline-flex")}
    >
      <span aria-hidden>{label}</span>
      {badge && <ComingSoonBadge />}
    </span>
  );
}
