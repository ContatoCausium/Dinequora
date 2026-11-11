import maraoLogo from "@/assets/marao-logo.png.asset.json";
import type { BrandColors } from "./theme-engine";

export type PlanId = "starter" | "growth" | "professional" | "enterprise";

export type Plan = { id: PlanId; maxLocations: number; maxEmployees: number; monthlyPrice: number };

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", maxLocations: 1, maxEmployees: 15, monthlyPrice: 89 },
  growth: { id: "growth", maxLocations: 3, maxEmployees: 60, monthlyPrice: 249 },
  professional: { id: "professional", maxLocations: 10, maxEmployees: 250, monthlyPrice: 649 },
  enterprise: { id: "enterprise", maxLocations: 9999, maxEmployees: 99999, monthlyPrice: 0 },
};

export type Location = {
  id: string;
  name: string;
  /** "verified" = sourced from the public website; "placeholder" = demo slot awaiting real data. */
  status: "verified" | "placeholder";
  address?: string | undefined;
  timezone: string;
  /** Backend id; present for locations loaded from the database. */
  dbId?: string | undefined;
  lifecycle?: "active" | "inactive" | "placeholder" | undefined;
  phone?: string | undefined;
  hours?: Record<string, { open: string; close: string } | null> | undefined;
  /**
   * Sales-tax rate the POS charges at this store, in parts per million (88,750 = 8.875%); null =
   * not configured yet, so no sale can be recorded there (migration 0025).
   */
  taxRatePpm?: number | null | undefined;
  /** Relative size factor used only to shape synthetic demo data. */
  demoScale: number;
};

export type Organization = {
  id: string;
  name: string;
  initials: string;
  logoUrl?: string | undefined;
  brand: BrandColors;
  previousBrand?: (BrandColors & { logoUrl?: string | undefined }) | undefined;
  onboardingStep?: number | undefined;
  plan: PlanId;
  subscription: "trial" | "active" | "past_due";
  /** true for organizations that are entirely fictional demo tenants. */
  fictional: boolean;
  categories: string[];
  topItems: { name: string; price: number }[];
  locations: Location[];
};

export const ORGANIZATIONS: Organization[] = [
  {
    id: "org_marao",
    name: "MARAO BURGERS",
    initials: "MB",
    logoUrl: maraoLogo.url,
    brand: { primary: "#d63c46", accent: "#f2a43a" },
    plan: "growth",
    subscription: "active",
    fictional: false,
    categories: [
      "American Burgers",
      "Brazilian Burgers",
      "Combos",
      "Açaí",
      "Pastel",
      "Fried Chicken",
      "Wraps, Subs & Hot Dogs",
      "Drinks",
      "Desserts",
      "Salads",
    ],
    topItems: [
      { name: "X-Tudo De Marao", price: 0 },
      { name: "Super X-Tudo De Marao", price: 0 },
      { name: "Bacon Cheeseburger", price: 11.99 },
      { name: "Brazilian Hamburger", price: 0 },
      { name: "X-Bacon", price: 0 },
      { name: "LG Acai Bowl", price: 19.99 },
    ],
    locations: [
      {
        id: "loc_marao_framingham",
        name: "MARAO Framingham",
        status: "verified",
        address: "61 Hollis St, Framingham, MA 01702",
        timezone: "America/New_York",
        demoScale: 1,
      },
      {
        id: "loc_marao_2",
        name: "Location 2",
        status: "placeholder",
        timezone: "America/New_York",
        demoScale: 0.78,
      },
      {
        id: "loc_marao_3",
        name: "Location 3",
        status: "placeholder",
        timezone: "America/New_York",
        demoScale: 0.62,
      },
    ],
  },
  {
    id: "org_harbor",
    name: "Harbor Taco Co.",
    initials: "HT",
    brand: { primary: "#16707a", accent: "#e8b64c" },
    plan: "starter",
    subscription: "trial",
    fictional: true,
    categories: ["Tacos", "Bowls", "Sides", "Drinks"],
    topItems: [
      { name: "Fish Taco", price: 0 },
      { name: "Carnitas Bowl", price: 0 },
      { name: "Street Corn", price: 0 },
      { name: "Horchata", price: 0 },
    ],
    locations: [
      {
        id: "loc_harbor_1",
        name: "Harbor Taco · Demo Store",
        status: "placeholder",
        timezone: "America/New_York",
        demoScale: 0.7,
      },
    ],
  },
];

export const getOrg = (id: string) => ORGANIZATIONS.find((o) => o.id === id) ?? ORGANIZATIONS[0]!;
