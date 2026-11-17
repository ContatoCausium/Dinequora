/**
 * Kitchen ticket age thresholds (minutes since the order was created). A ticket is "late" from
 * `warningMinutes` and "overdue" from `delayedMinutes`. Shared by the KDS board (getTicketUrgency)
 * and the sidebar counter (server-side count), so both always agree on what "late" means.
 * Dependency-free on purpose: imported by server functions.
 */
export interface KDSThresholds {
  warningMinutes: number;
  delayedMinutes: number;
}

export const DEFAULT_THRESHOLDS: KDSThresholds = {
  warningMinutes: 10,
  delayedMinutes: 20,
};
