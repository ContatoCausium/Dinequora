interface ReceiptTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * The receipt describes the order the server recorded, never the client's estimate or the type of
 * organization: totals come from the server read-back, and the "simulation" label appears only
 * when the stored order is flagged as a simulation.
 */
export function confirmedReceipt<T extends ReceiptTotals>(
  paid: T,
  confirmed: {
    subtotalCents?: number | undefined;
    taxCents?: number | undefined;
    totalCents?: number | undefined;
    isSimulation?: boolean | undefined;
  },
): T & { isSimulation: boolean } {
  return {
    ...paid,
    subtotalCents: confirmed.subtotalCents ?? paid.subtotalCents,
    taxCents: confirmed.taxCents ?? paid.taxCents,
    totalCents: confirmed.totalCents ?? paid.totalCents,
    isSimulation: confirmed.isSimulation === true,
  };
}
