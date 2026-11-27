import { useSyncExternalStore } from "react";

/**
 * Demo presentation mode ("vitrine"): an explicit, temporary choice to show ILLUSTRATIVE data on the
 * Dashboard, the notifications, the store cards and the kitchen board, for a sales demonstration.
 *
 * It is not organizations.is_demo. is_demo is the organization's classification and stays as it is;
 * by itself it never replaces recorded data with synthetic numbers. A demo organization sees its
 * real orders, finance and alerts until someone deliberately turns this mode on.
 *
 * Kept in memory only — never written to localStorage, sessionStorage, cookies or the database — so a
 * reload, a new tab, a new session or a sign-out always starts with it off. It is keyed by user and
 * organization, so it never carries over to another account or organization. It only changes what is
 * displayed: it has no access to orders, payments, stock or finance and cannot write them.
 */
let activeKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function presentationKey(userId: string, orgId: string): string {
  return `${userId}::${orgId}`;
}

export function startPresentation(key: string): void {
  if (activeKey === key) return;
  activeKey = key;
  emit();
}

export function stopPresentation(): void {
  if (activeKey === null) return;
  activeKey = null;
  emit();
}

export function isPresentationActive(key: string): boolean {
  return activeKey === key;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The key the mode is on for (null = off). Server render: always off. */
export function usePresentationActiveKey(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => activeKey,
    () => null,
  );
}
