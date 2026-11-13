// Types of scripts/preview/dataset.mjs (used by src/test/client-preview-dataset.test.ts).
export const DATASET_VERSION: number;
export const LEDGER_READ_CAP: number;
export const DATASET_PROFILES: Readonly<
  Record<"ledger-safe" | "full", { days: number; volume: number }>
>;
export const COST_FACTOR: number;
export const ORG: {
  name: string;
  companyName: string;
  companyAddress: string;
  brandPrimary: string;
  brandAccent: string;
  plan: string;
};
export const EMAIL_DOMAIN: string;
export const TIMEZONE: string;
export type Account = {
  key: string;
  email: string;
  fullName: string;
  role: "owner" | "manager" | "staff";
  profile?: string | undefined;
  stores?: string[] | undefined;
};
export const ACCOUNTS: readonly Account[];
export type Store = {
  key: string;
  name: string;
  address: string;
  phone: string;
  taxRatePpm: number;
  baseOrders: number;
  open: [number, number];
  close: [number, number];
  peaks: [number, number];
  types: Record<"dine_in" | "takeout" | "delivery", number>;
};
export const STORES: readonly Store[];
export const CATEGORIES: readonly { id: string; name: string }[];
export type StockItem = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  costCents: number;
  pack: number;
  supplier: string;
};
export const STOCK: readonly StockItem[];
export const SUPPLIERS: readonly { key: string; name: string; notes: string }[];
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: { id: string; name: string; priceCents: number }[];
};
export type Product = {
  id: string;
  category: string;
  name: string;
  priceCents: number;
  prep: number;
  weight: number;
  description: string;
  modifiers: ModifierGroup[];
  notAt?: string[] | undefined;
  recipe: [string, number, string, number][];
};
export const PRODUCTS: readonly Product[];
export type PlannedSale = {
  clientOrderId: string;
  store: string;
  at: number;
  type: "dine_in" | "takeout" | "delivery";
  payment: "card" | "cash" | "digital";
  customerName: string;
  tableNumber: string;
  deliveryAddress: string;
  customerPhone: string;
  discountCents: number;
  items: {
    productId: string;
    quantity: number;
    modifiers: { groupId: string; optionId: string }[];
  }[];
  subtotalCents: number;
  steps: { status: string; at: number }[];
  liveStatus: string | null;
};
export type PlannedReceipt = {
  key: string;
  supplier: string;
  orderedAt: number;
  receivedAt: number;
  items: { sku: string; quantity: number; unitPriceCents: number }[];
};
export type Dataset = {
  version: number;
  seed: number;
  now: number;
  startYmd: string;
  todayYmd: string;
  openingsAt: number;
  stores: (Store & { products: string[]; sales: PlannedSale[]; openTickets: PlannedSale[] })[];
  stockPlan: Record<
    string,
    {
      opening: Record<string, number>;
      receipts: PlannedReceipt[];
      openPo: {
        key: string;
        supplier: string;
        items: { sku: string; quantity: number; unitPriceCents: number }[];
      };
      minQuantity: Record<string, number>;
      expectedFinal: Record<string, number>;
      lowAtEnd: string[];
      alertKeep: Record<string, number>;
    }
  >;
  events: (
    | { kind: "sale"; store: string; at: number; sale: PlannedSale }
    | { kind: "receipt"; store: string; at: number; receipt: PlannedReceipt }
  )[];
  expenses: { store: string; payload: Record<string, unknown> }[];
  summary: {
    orders: number;
    cancelled: number;
    receipts: number;
    expenses: number;
    days: number;
    profile: string;
    ledgerEntries: number;
    stores: { key: string; sales: number; openTickets: number }[];
  };
};
export function buildDataset(options: {
  now: number;
  profile?: "ledger-safe" | "full" | undefined;
  seed?: number | undefined;
}): Dataset;
export function convertQuantity(quantity: number, from: string, to: string): number;
export function rng(seed: number): () => number;
export function zonedInstant(ymd: string, hour: number, minute: number, timeZone?: string): number;
export function localYmd(ms: number, timeZone?: string): string;
