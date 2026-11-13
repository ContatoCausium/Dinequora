// Deterministic dataset of the CLIENT PREVIEW: "Dinequora Demo Restaurant", a fictional American
// fast-casual brand with three stores (Downtown, Westside, Airport). Pure: no network, no database,
// no clock — `now` is an argument, and the same seed + now always give the same plan.
//
// Everything here is fictional: names, addresses (the 555-01xx phone range is reserved for fiction),
// suppliers ("Demo …"), customers and accounts (reserved .test domain). The plan is executed by
// scripts/preview/seed-client-preview.mjs through the same RPCs as the UI, so prices, tax, stock,
// COGS, payments, receipts and the finance ledger are computed by the server, then moved to the
// planned business times by public.client_preview_backdate (scripts/preview/sql).
//
// Stock is planned with the server's own consumption rule (finalize_pos_sale_atomic_v2):
//   qty = operational_unit_quantity(ingredient qty, ingredient unit, stock unit)
//         * (1 + waste% / 100) * line quantity / servings
// so that, executed in business-time order, no sale ever finds insufficient stock.

export const DATASET_VERSION = 1;

// Volume profiles. The app reads the whole finance ledger in ONE PostgREST request
// (fetchOperationalResources -> finance_entries, no paging), and PostgREST returns at most 1,000
// rows (Supabase default "max rows"): with more entries the Finance and Reports screens would add
// up an arbitrary subset. "ledger-safe" keeps the whole ledger under that cap so every screen agrees
// with the Dashboard; "full" is the realistic volume, for when the ledger read is paged.
export const LEDGER_READ_CAP = 1000;
export const DATASET_PROFILES = Object.freeze({
  "ledger-safe": Object.freeze({ days: 21, volume: 0.2 }),
  full: Object.freeze({ days: 35, volume: 1 }),
});
export const ORG = Object.freeze({
  name: "Dinequora Demo Restaurant",
  companyName: "Dinequora Demo Restaurant LLC",
  companyAddress: "100 Demo Plaza, Suite 400, Springfield, USA (fictional)",
  brandPrimary: "#b4532a",
  brandAccent: "#f2a43a",
  plan: "growth",
});
export const EMAIL_DOMAIN = "client-preview.dinequora.test";
export const ACCOUNTS = Object.freeze([
  { key: "owner", email: `owner@${EMAIL_DOMAIN}`, fullName: "Demo Owner", role: "owner" },
  {
    key: "manager",
    email: `manager.westside@${EMAIL_DOMAIN}`,
    fullName: "Jamie Rivera (demo)",
    role: "manager",
    stores: ["westside"],
  },
  {
    key: "kitchen",
    email: `kitchen.downtown@${EMAIL_DOMAIN}`,
    fullName: "Sam Lee (demo)",
    role: "staff",
    profile: "kitchen",
    stores: ["downtown"],
  },
]);
export const TIMEZONE = "America/New_York";

// Stores. The first one is created with the organization (create_test_restaurant).
export const STORES = Object.freeze([
  {
    key: "downtown",
    name: "Downtown",
    address: "245 Market Street, Springfield (fictional)",
    phone: "+1 555-0141",
    taxRatePpm: 70000,
    baseOrders: 30,
    open: [11, 0],
    close: [22, 0],
    peaks: [12.5, 19],
    types: { dine_in: 0.45, takeout: 0.4, delivery: 0.15 },
  },
  {
    key: "westside",
    name: "Westside",
    address: "1880 Westside Boulevard, Springfield (fictional)",
    phone: "+1 555-0142",
    taxRatePpm: 70000,
    baseOrders: 22,
    open: [11, 0],
    close: [21, 30],
    peaks: [12.5, 18.5],
    types: { dine_in: 0.5, takeout: 0.3, delivery: 0.2 },
  },
  {
    key: "airport",
    name: "Airport",
    address: "Terminal B, Gate 12 Food Court, Springfield Intl. Airport (fictional)",
    phone: "+1 555-0143",
    taxRatePpm: 77500,
    baseOrders: 38,
    open: [6, 0],
    close: [21, 0],
    peaks: [8, 12.5],
    types: { dine_in: 0.3, takeout: 0.7, delivery: 0 },
  },
]);

export const CATEGORIES = Object.freeze([
  { id: "cat-burgers", name: "Burgers" },
  { id: "cat-chicken-bowls", name: "Chicken & Bowls" },
  { id: "cat-sides", name: "Sides" },
  { id: "cat-drinks", name: "Drinks" },
  { id: "cat-desserts", name: "Desserts" },
]);

const ADDONS = Object.freeze({
  id: "mg-burger-addons",
  name: "Add-ons",
  required: false,
  minSelections: 0,
  maxSelections: 3,
  options: [
    { id: "opt-extra-cheese", name: "Extra cheese", priceCents: 100 },
    { id: "opt-bacon", name: "Add bacon", priceCents: 200 },
    { id: "opt-avocado", name: "Avocado", priceCents: 175 },
  ],
});

// Stock catalog (same in every store). unit: stock unit; cost in cents per stock unit (list price
// x COST_FACTOR, which puts the food cost near 29% of net sales, typical of fast casual);
// pack: purchase multiple; supplier key.
export const COST_FACTOR = 1.45;
const STOCK_LIST = [
  {
    sku: "BEEF-PATTY",
    name: "Beef patty 4 oz",
    category: "meat",
    unit: "units",
    costCents: 145,
    pack: 40,
    supplier: "meat",
  },
  {
    sku: "CHK-BREAST",
    name: "Chicken breast",
    category: "meat",
    unit: "lb",
    costCents: 420,
    pack: 10,
    supplier: "meat",
  },
  {
    sku: "CHK-FILLET",
    name: "Breaded chicken fillet",
    category: "meat",
    unit: "units",
    costCents: 165,
    pack: 24,
    supplier: "meat",
  },
  {
    sku: "BACON",
    name: "Smoked bacon",
    category: "meat",
    unit: "lb",
    costCents: 650,
    pack: 5,
    supplier: "meat",
  },
  {
    sku: "VEG-PATTY",
    name: "Veggie patty",
    category: "produce",
    unit: "units",
    costCents: 175,
    pack: 24,
    supplier: "produce",
  },
  {
    sku: "BUN",
    name: "Brioche bun",
    category: "bakery",
    unit: "units",
    costCents: 45,
    pack: 48,
    supplier: "bakery",
  },
  {
    sku: "CHEDDAR",
    name: "Cheddar slices",
    category: "dairy",
    unit: "units",
    costCents: 18,
    pack: 120,
    supplier: "produce",
  },
  {
    sku: "LETTUCE",
    name: "Iceberg lettuce",
    category: "produce",
    unit: "lb",
    costCents: 180,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "TOMATO",
    name: "Tomatoes",
    category: "produce",
    unit: "lb",
    costCents: 210,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "ONION",
    name: "Yellow onions",
    category: "produce",
    unit: "lb",
    costCents: 90,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "ROMAINE",
    name: "Romaine hearts",
    category: "produce",
    unit: "lb",
    costCents: 220,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "QUINOA",
    name: "Quinoa",
    category: "dry_goods",
    unit: "lb",
    costCents: 350,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "ROAST-VEG",
    name: "Roasted vegetable mix",
    category: "produce",
    unit: "lb",
    costCents: 300,
    pack: 10,
    supplier: "produce",
  },
  {
    sku: "PARMESAN",
    name: "Parmesan, grated",
    category: "dairy",
    unit: "lb",
    costCents: 900,
    pack: 5,
    supplier: "produce",
  },
  {
    sku: "CAESAR",
    name: "Caesar dressing",
    category: "dry_goods",
    unit: "gal",
    costCents: 2400,
    pack: 1,
    supplier: "produce",
  },
  {
    sku: "BBQ",
    name: "BBQ sauce",
    category: "dry_goods",
    unit: "gal",
    costCents: 1500,
    pack: 1,
    supplier: "produce",
  },
  {
    sku: "FRIES",
    name: "Frozen fries",
    category: "produce",
    unit: "lb",
    costCents: 120,
    pack: 30,
    supplier: "produce",
  },
  {
    sku: "SWEET-FRIES",
    name: "Sweet potato fries",
    category: "produce",
    unit: "lb",
    costCents: 190,
    pack: 20,
    supplier: "produce",
  },
  {
    sku: "RINGS",
    name: "Onion rings, frozen",
    category: "produce",
    unit: "lb",
    costCents: 260,
    pack: 20,
    supplier: "produce",
  },
  {
    sku: "OIL",
    name: "Fryer oil",
    category: "dry_goods",
    unit: "gal",
    costCents: 1800,
    pack: 5,
    supplier: "produce",
  },
  {
    sku: "SODA-SYRUP",
    name: "Fountain soda syrup",
    category: "beverages",
    unit: "gal",
    costCents: 2200,
    pack: 5,
    supplier: "beverage",
  },
  {
    sku: "LEMONADE",
    name: "Lemonade base",
    category: "beverages",
    unit: "gal",
    costCents: 900,
    pack: 5,
    supplier: "beverage",
  },
  {
    sku: "ICED-TEA",
    name: "Iced tea concentrate",
    category: "beverages",
    unit: "gal",
    costCents: 800,
    pack: 5,
    supplier: "beverage",
  },
  {
    sku: "COLD-BREW",
    name: "Cold brew concentrate",
    category: "beverages",
    unit: "gal",
    costCents: 2600,
    pack: 2,
    supplier: "beverage",
  },
  {
    sku: "WATER",
    name: "Bottled water 16.9 oz",
    category: "beverages",
    unit: "units",
    costCents: 40,
    pack: 24,
    supplier: "beverage",
  },
  {
    sku: "MILK",
    name: "Whole milk",
    category: "dairy",
    unit: "gal",
    costCents: 450,
    pack: 4,
    supplier: "produce",
  },
  {
    sku: "ICE-CREAM",
    name: "Vanilla ice cream",
    category: "dairy",
    unit: "gal",
    costCents: 1400,
    pack: 3,
    supplier: "produce",
  },
  {
    sku: "BROWNIE",
    name: "Chocolate brownie",
    category: "bakery",
    unit: "units",
    costCents: 110,
    pack: 24,
    supplier: "bakery",
  },
  {
    sku: "APPLE-PIE",
    name: "Apple pie slice",
    category: "bakery",
    unit: "units",
    costCents: 140,
    pack: 16,
    supplier: "bakery",
  },
  {
    sku: "CUP",
    name: "Cups 16 oz",
    category: "packaging",
    unit: "pack",
    costCents: 1500,
    pack: 2,
    supplier: "beverage",
  },
  {
    sku: "BOX",
    name: "Takeout containers",
    category: "packaging",
    unit: "pack",
    costCents: 2200,
    pack: 2,
    supplier: "produce",
  },
];
export const STOCK = Object.freeze(
  STOCK_LIST.map((s) => Object.freeze({ ...s, costCents: Math.round(s.costCents * COST_FACTOR) })),
);

export const SUPPLIERS = Object.freeze([
  { key: "meat", name: "Demo Meat & Poultry Supply", notes: "Fictional supplier (client preview)" },
  { key: "produce", name: "Demo Fresh Produce Co.", notes: "Fictional supplier (client preview)" },
  { key: "beverage", name: "Demo Beverage Partners", notes: "Fictional supplier (client preview)" },
  { key: "bakery", name: "Demo Bakery Supply", notes: "Fictional supplier (client preview)" },
]);

// Products: price, prep time, sales weight, ingredients [sku, quantity, unit, waste%].
// Cups/containers are "pack" items of 50 (1/50 = 0.02 pack per serving).
const CUP = ["CUP", 0.02, "pack", 0];
const BOX = ["BOX", 0.02, "pack", 0];
export const PRODUCTS = Object.freeze([
  {
    id: "prod-classic-burger",
    category: "cat-burgers",
    name: "Classic Burger",
    priceCents: 1350,
    prep: 9,
    weight: 14,
    description: "Beef patty, lettuce, tomato, onion, house sauce on a brioche bun.",
    modifiers: [ADDONS],
    recipe: [
      ["BEEF-PATTY", 1, "units", 0],
      ["BUN", 1, "units", 0],
      ["LETTUCE", 0.75, "oz", 5],
      ["TOMATO", 1, "oz", 5],
      ["ONION", 0.5, "oz", 5],
      BOX,
    ],
  },
  {
    id: "prod-cheeseburger",
    category: "cat-burgers",
    name: "Cheeseburger",
    priceCents: 1450,
    prep: 9,
    weight: 16,
    description: "Classic burger with two slices of aged cheddar.",
    modifiers: [ADDONS],
    recipe: [
      ["BEEF-PATTY", 1, "units", 0],
      ["BUN", 1, "units", 0],
      ["CHEDDAR", 2, "units", 0],
      ["LETTUCE", 0.75, "oz", 5],
      ["TOMATO", 1, "oz", 5],
      BOX,
    ],
  },
  {
    id: "prod-bacon-bbq-burger",
    category: "cat-burgers",
    name: "Bacon BBQ Burger",
    priceCents: 1600,
    prep: 11,
    weight: 9,
    description: "Double-smoked bacon, cheddar, crispy onions and BBQ sauce.",
    modifiers: [ADDONS],
    recipe: [
      ["BEEF-PATTY", 1, "units", 0],
      ["BUN", 1, "units", 0],
      ["CHEDDAR", 1, "units", 0],
      ["BACON", 1.5, "oz", 0],
      ["BBQ", 2, "tbsp", 0],
      ["ONION", 0.75, "oz", 5],
      BOX,
    ],
  },
  {
    id: "prod-veggie-burger",
    category: "cat-burgers",
    name: "Garden Veggie Burger",
    priceCents: 1400,
    prep: 9,
    weight: 5,
    description: "Plant-based patty, lettuce, tomato and pickled onions.",
    modifiers: [ADDONS],
    recipe: [
      ["VEG-PATTY", 1, "units", 0],
      ["BUN", 1, "units", 0],
      ["LETTUCE", 0.75, "oz", 5],
      ["TOMATO", 1, "oz", 5],
      BOX,
    ],
  },
  {
    id: "prod-grilled-chicken",
    category: "cat-chicken-bowls",
    name: "Grilled Chicken Sandwich",
    priceCents: 1300,
    prep: 10,
    weight: 7,
    description: "Herb-marinated chicken breast, lettuce and tomato.",
    modifiers: [],
    recipe: [
      ["CHK-BREAST", 6, "oz", 0],
      ["BUN", 1, "units", 0],
      ["LETTUCE", 0.75, "oz", 5],
      ["TOMATO", 1, "oz", 5],
      BOX,
    ],
  },
  {
    id: "prod-crispy-chicken",
    category: "cat-chicken-bowls",
    name: "Crispy Chicken Sandwich",
    priceCents: 1350,
    prep: 10,
    weight: 9,
    description: "Buttermilk-breaded fillet, pickles and slaw.",
    modifiers: [],
    recipe: [
      ["CHK-FILLET", 1, "units", 0],
      ["BUN", 1, "units", 0],
      ["LETTUCE", 0.5, "oz", 5],
      ["OIL", 0.01, "gal", 0],
      BOX,
    ],
  },
  {
    id: "prod-caesar-salad",
    category: "cat-chicken-bowls",
    name: "Chicken Caesar Salad",
    priceCents: 1250,
    prep: 7,
    weight: 5,
    description: "Romaine, grilled chicken, parmesan and Caesar dressing.",
    modifiers: [],
    recipe: [
      ["ROMAINE", 5, "oz", 8],
      ["CHK-BREAST", 4, "oz", 0],
      ["PARMESAN", 0.5, "oz", 0],
      ["CAESAR", 2, "tbsp", 0],
      BOX,
    ],
  },
  {
    id: "prod-harvest-bowl",
    category: "cat-chicken-bowls",
    name: "Harvest Bowl",
    priceCents: 1300,
    prep: 8,
    weight: 4,
    description: "Quinoa, roasted vegetables and grilled chicken.",
    modifiers: [],
    recipe: [["QUINOA", 4, "oz", 0], ["ROAST-VEG", 5, "oz", 5], ["CHK-BREAST", 4, "oz", 0], BOX],
  },
  {
    id: "prod-fries",
    category: "cat-sides",
    name: "Classic Fries",
    priceCents: 450,
    prep: 5,
    weight: 22,
    description: "Skin-on fries with sea salt.",
    modifiers: [],
    recipe: [
      ["FRIES", 6, "oz", 3],
      ["OIL", 0.005, "gal", 0],
    ],
  },
  {
    id: "prod-sweet-fries",
    category: "cat-sides",
    name: "Sweet Potato Fries",
    priceCents: 525,
    prep: 6,
    weight: 8,
    description: "Crispy sweet potato fries.",
    modifiers: [],
    recipe: [
      ["SWEET-FRIES", 6, "oz", 3],
      ["OIL", 0.005, "gal", 0],
    ],
  },
  {
    id: "prod-onion-rings",
    category: "cat-sides",
    name: "Onion Rings",
    priceCents: 550,
    prep: 6,
    weight: 6,
    notAt: ["airport"],
    description: "Beer-battered onion rings.",
    modifiers: [],
    recipe: [
      ["RINGS", 5, "oz", 3],
      ["OIL", 0.006, "gal", 0],
    ],
  },
  {
    id: "prod-fountain-soda",
    category: "cat-drinks",
    name: "Fountain Soda",
    priceCents: 295,
    prep: 1,
    weight: 18,
    description: "Classic cola, diet cola, lemon-lime or root beer.",
    modifiers: [],
    recipe: [["SODA-SYRUP", 0.025, "gal", 0], CUP],
  },
  {
    id: "prod-lemonade",
    category: "cat-drinks",
    name: "Fresh Lemonade",
    priceCents: 395,
    prep: 1,
    weight: 9,
    description: "House lemonade, made daily.",
    modifiers: [],
    recipe: [["LEMONADE", 0.1, "gal", 0], CUP],
  },
  {
    id: "prod-iced-tea",
    category: "cat-drinks",
    name: "Iced Tea",
    priceCents: 325,
    prep: 1,
    weight: 6,
    description: "Unsweetened black iced tea.",
    modifiers: [],
    recipe: [["ICED-TEA", 0.03, "gal", 0], CUP],
  },
  {
    id: "prod-cold-brew",
    category: "cat-drinks",
    name: "Cold Brew Coffee",
    priceCents: 425,
    prep: 1,
    weight: 7,
    description: "Slow-steeped cold brew over ice.",
    modifiers: [],
    recipe: [["COLD-BREW", 0.04, "gal", 0], CUP],
  },
  {
    id: "prod-bottled-water",
    category: "cat-drinks",
    name: "Bottled Water",
    priceCents: 225,
    prep: 0,
    weight: 6,
    description: "16.9 oz still water.",
    modifiers: [],
    recipe: [["WATER", 1, "units", 0]],
  },
  {
    id: "prod-brownie",
    category: "cat-desserts",
    name: "Chocolate Brownie",
    priceCents: 495,
    prep: 1,
    weight: 5,
    description: "Fudgy brownie with walnuts.",
    modifiers: [],
    recipe: [["BROWNIE", 1, "units", 0]],
  },
  {
    id: "prod-milkshake",
    category: "cat-desserts",
    name: "Vanilla Milkshake",
    priceCents: 595,
    prep: 3,
    weight: 5,
    description: "Hand-spun vanilla shake.",
    modifiers: [],
    recipe: [["ICE-CREAM", 0.08, "gal", 0], ["MILK", 0.04, "gal", 0], CUP],
  },
  {
    id: "prod-apple-pie",
    category: "cat-desserts",
    name: "Apple Pie",
    priceCents: 475,
    prep: 1,
    weight: 3,
    notAt: ["westside"],
    description: "Warm apple pie slice.",
    modifiers: [],
    recipe: [["APPLE-PIE", 1, "units", 0]],
  },
]);

// Monthly expenses per store (cents) and their schedule.
const EXPENSES = Object.freeze({
  downtown: {
    rent: 650000,
    payroll: 950000,
    energy: 98000,
    water: 26000,
    internet: 18000,
    marketing: 60000,
  },
  westside: {
    rent: 520000,
    payroll: 740000,
    energy: 81000,
    water: 21000,
    internet: 18000,
    marketing: 45000,
  },
  airport: {
    rent: 980000,
    payroll: 1200000,
    energy: 112000,
    water: 30000,
    internet: 22000,
    marketing: 30000,
  },
});

// ---------------------------------------------------------------------------------------- helpers
const MASS = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 };
const VOLUME = {
  ml: 1,
  l: 1000,
  gal: 3785.411784,
  tsp: 4.928921594,
  tbsp: 14.78676478,
  cup: 236.5882365,
};
/** Same factors and refusals as public.operational_unit_quantity. */
export function convertQuantity(quantity, from, to) {
  if (!(quantity > 0)) throw new Error("invalid_quantity");
  if (from === to) return quantity;
  if (MASS[from] && MASS[to]) return (quantity * MASS[from]) / MASS[to];
  if (VOLUME[from] && VOLUME[to]) return (quantity * VOLUME[from]) / VOLUME[to];
  throw new Error(`incompatible_units ${from}->${to}`);
}

/** mulberry32: small, fast, deterministic. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) if ((x -= w) < 0) return v;
  return entries[entries.length - 1][0];
};

/** UTC instant of a wall-clock time in a time zone (no library; handles DST). */
// Intl formatters are expensive to build: one per time zone, reused (the plan converts thousands
// of times).
const partsFormat = new Map();
const dayFormat = new Map();
const cached = (map, timeZone, make) => {
  let f = map.get(timeZone);
  if (!f) map.set(timeZone, (f = make()));
  return f;
};
export function zonedInstant(ymd, hour, minute, timeZone = TIMEZONE) {
  const [y, m, d] = ymd.split("-").map(Number);
  const fmt = cached(
    partsFormat,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
  );
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess += Date.UTC(y, m - 1, d, hour, minute) - shown;
  }
  return guess;
}
/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localYmd(ms, timeZone = TIMEZONE) {
  return cached(
    dayFormat,
    timeZone,
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
  ).format(new Date(ms));
}
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const iso = (ms) => new Date(ms).toISOString();

const FIRST = [
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Avery",
  "Quinn",
  "Jamie",
  "Drew",
  "Parker",
  "Reese",
  "Skyler",
  "Rowan",
  "Emerson",
  "Hayden",
  "Sage",
];
const LAST = "ABCDEFGHJKLMNPRSTVW";
const WEEKDAY_FACTOR = [1.1, 0.8, 0.85, 0.9, 1.0, 1.25, 1.35]; // Sun..Sat

// ------------------------------------------------------------------------------------------- plan
/**
 * Builds the full plan. Options: now (ms, required), days of history (default 35), seed.
 * Returns { version, now, startYmd, todayYmd, stores, products, stock, suppliers, events, expenses, summary }
 * where events are in business-time order: opening, receipt, sale (with steps) — per store.
 */
export function buildDataset({ now, profile = "ledger-safe", seed = 20261114 } = {}) {
  const shape = DATASET_PROFILES[profile];
  if (!shape) throw new Error(`unknown dataset profile ${profile}`);
  const { days, volume } = shape;
  if (!Number.isFinite(now)) throw new Error("now is required");
  const r = rng(seed);
  const todayYmd = localYmd(now);
  const startYmd = addDays(todayYmd, -days);
  const openingsAt = zonedInstant(startYmd, 7, 0);
  const stockBySku = Object.fromEntries(STOCK.map((s) => [s.sku, s]));

  // Validate recipes against the stock catalog with the server rules.
  for (const p of PRODUCTS)
    for (const [sku, qty, unit] of p.recipe) {
      const s = stockBySku[sku];
      if (!s) throw new Error(`${p.id}: unknown stock ${sku}`);
      convertQuantity(qty, unit, s.unit);
    }
  const perServing = (p) =>
    p.recipe.map(([sku, qty, unit, waste]) => [
      sku,
      convertQuantity(qty, unit, stockBySku[sku].unit) * (1 + waste / 100),
    ]);

  const stores = STORES.map((store) => {
    const sold = PRODUCTS.filter((p) => !(p.notAt ?? []).includes(store.key));
    const sales = [];
    const openTickets = [];
    let seq = 0;
    for (let day = 0; day <= days; day++) {
      const ymd = addDays(startYmd, day);
      const trend = 0.9 + (0.2 * day) / days; // gentle growth over the period
      const noise = 0.9 + r() * 0.2;
      const target = Math.max(
        1,
        Math.round(store.baseOrders * volume * WEEKDAY_FACTOR[weekday(ymd)] * trend * noise),
      );
      const openMin = store.open[0] * 60 + store.open[1];
      const closeMin = store.close[0] * 60 + store.close[1];
      for (let i = 0; i < target; i++) {
        // Time of day: two peaks plus a uniform floor.
        const peak = store.peaks[r() < 0.55 ? 0 : 1];
        const gauss = (r() + r() + r() - 1.5) * 1.6; // ~N(0, 0.8h)
        let minute = r() < 0.25 ? openMin + r() * (closeMin - openMin - 20) : (peak + gauss) * 60;
        minute = Math.min(Math.max(minute, openMin + 2), closeMin - 15);
        const at =
          zonedInstant(ymd, Math.floor(minute / 60), Math.floor(minute % 60)) +
          Math.floor(r() * 60) * 1000;
        if (at > now - 25 * 60_000) continue; // only the past; the live board is planned below
        sales.push(
          planSale(r, store, sold, at, `${store.key}-${ymd}-${String(++seq).padStart(4, "0")}`),
        );
      }
    }
    // Live kitchen board: a few open tickets from the last minutes.
    const live = [
      ["confirmed", 3],
      ["confirmed", 1],
      ["in_prep", 7],
      ["in_prep", 5],
      ["ready", 12],
    ];
    for (const [status, ago] of live) {
      const at = now - ago * 60_000 - Math.floor(r() * 50) * 1000;
      const s = planSale(
        r,
        store,
        sold,
        at,
        `${store.key}-live-${String(++seq).padStart(4, "0")}`,
        status,
      );
      openTickets.push(s);
    }
    sales.sort((a, b) => a.at - b.at);
    return { ...store, products: sold.map((p) => p.id), sales, openTickets };
  });

  function planSale(r2, store, sold, at, clientOrderId, liveStatus) {
    const lines = new Map();
    const add = (id, q = 1) => lines.set(id, (lines.get(id) ?? 0) + q);
    const mains = sold.filter(
      (p) => p.category === "cat-burgers" || p.category === "cat-chicken-bowls",
    );
    const sides = sold.filter((p) => p.category === "cat-sides");
    const drinks = sold.filter((p) => p.category === "cat-drinks");
    const desserts = sold.filter((p) => p.category === "cat-desserts");
    const w = (list) => list.map((p) => [p.id, p.weight]);
    const people = r2() < 0.55 ? 1 : r2() < 0.7 ? 2 : r2() < 0.75 ? 3 : 4;
    for (let k = 0; k < people; k++) {
      const breakfast = store.key === "airport" && new Date(at).getUTCHours() < 14 && r2() < 0.35;
      if (breakfast)
        add(
          pick(
            r2,
            w(drinks.filter((p) => p.id === "prod-cold-brew" || p.id === "prod-bottled-water")),
          ),
        );
      else {
        add(pick(r2, w(mains)));
        if (r2() < 0.7) add(pick(r2, w(sides)));
        if (r2() < 0.75) add(pick(r2, w(drinks)));
        if (r2() < 0.15) add(pick(r2, w(desserts)));
      }
    }
    const items = [...lines.entries()].map(([productId, quantity]) => {
      const p = PRODUCTS.find((x) => x.id === productId);
      const modifiers = [];
      if (p.modifiers.length && r2() < 0.3) {
        modifiers.push({
          groupId: ADDONS.id,
          optionId: pick(r2, [
            ["opt-extra-cheese", 5],
            ["opt-bacon", 4],
            ["opt-avocado", 2],
          ]),
        });
      }
      return { productId, quantity, modifiers };
    });
    const type = pick(
      r2,
      Object.entries(store.types).filter(([, v]) => v > 0),
    );
    const payment = pick(r2, [
      ["card", 70],
      ["cash", 15],
      ["digital", 15],
    ]);
    const named = type !== "dine_in" || r2() < 0.2;
    const customerName = named
      ? `${FIRST[Math.floor(r2() * FIRST.length)]} ${LAST[Math.floor(r2() * LAST.length)]}.`
      : "Walk-in";
    const subtotal = items.reduce((s, it) => {
      const p = PRODUCTS.find((x) => x.id === it.productId);
      const mods = it.modifiers.reduce(
        (m, sel) => m + ADDONS.options.find((o) => o.id === sel.optionId).priceCents,
        0,
      );
      return s + (p.priceCents + mods) * it.quantity;
    }, 0);
    const discountCents = !liveStatus && r2() < 0.04 ? Math.min(300, Math.floor(subtotal / 10)) : 0;
    const maxPrep = Math.max(
      ...items.map((it) => PRODUCTS.find((x) => x.id === it.productId).prep),
    );
    const steps = [];
    let t = at;
    const cancel = !liveStatus && r2() < 0.015;
    if (liveStatus) {
      if (liveStatus !== "confirmed")
        steps.push({ status: "in_prep", at: (t += 60_000 + Math.floor(r2() * 90_000)) });
      if (liveStatus === "ready")
        steps.push({ status: "ready", at: (t += maxPrep * 60_000 + Math.floor(r2() * 120_000)) });
      // Live tickets are minutes old: keep every step in the past and in order.
      let ceiling = now - 30_000;
      for (let k = steps.length - 1; k >= 0; k--) {
        steps[k].at = Math.max(at + (k + 1) * 1000, Math.min(steps[k].at, ceiling));
        ceiling = steps[k].at - 1000;
      }
    } else if (cancel) {
      steps.push({ status: "cancelled", at: (t += 2 * 60_000 + Math.floor(r2() * 180_000)) });
    } else {
      steps.push({ status: "in_prep", at: (t += 45_000 + Math.floor(r2() * 150_000)) });
      steps.push({ status: "ready", at: (t += maxPrep * 60_000 + Math.floor(r2() * 240_000)) });
      steps.push({
        status: "delivered",
        at: (t += 60_000 + Math.floor(r2() * (type === "delivery" ? 1_500_000 : 360_000))),
      });
    }
    return {
      clientOrderId: `cp-${clientOrderId}`,
      store: store.key,
      at,
      type,
      payment,
      customerName,
      tableNumber: type === "dine_in" ? String(1 + Math.floor(r2() * 24)) : "",
      deliveryAddress:
        type === "delivery" ? `${100 + Math.floor(r2() * 900)} Demo Avenue (fictional)` : "",
      customerPhone:
        type === "delivery" ? `+1 555-01${String(Math.floor(r2() * 100)).padStart(2, "0")}` : "",
      discountCents,
      items,
      subtotalCents: subtotal,
      steps,
      liveStatus: liveStatus ?? null,
    };
  }

  // Stock plan per store: opening + weekly receipts sized from the planned consumption.
  const receiptDays = [7, 14, 21, 28].filter((d) => d < days).map((d) => addDays(startYmd, d));
  const events = [];
  const stockPlan = {};
  for (const store of stores) {
    const use = new Map(); // ymd -> Map(sku -> qty)
    const allSales = [...store.sales, ...store.openTickets];
    for (const s of allSales) {
      const ymd = localYmd(s.at);
      const m = use.get(ymd) ?? new Map();
      for (const it of s.items)
        for (const [sku, q] of perServing(PRODUCTS.find((p) => p.id === it.productId)))
          m.set(sku, (m.get(sku) ?? 0) + q * it.quantity);
      use.set(ymd, m);
    }
    const consumption = (fromYmd, toYmdExclusive) => {
      const out = new Map();
      for (const [ymd, m] of use)
        if (ymd >= fromYmd && ymd < toYmdExclusive)
          for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v);
      return out;
    };
    const roundUp = (x, pack) => Math.max(pack, Math.ceil(x / pack) * pack);
    const daily = consumption(startYmd, addDays(todayYmd, 1));
    const avgDaily = (sku) => (daily.get(sku) ?? 0) / (days + 1);
    // Two items end below their minimum so the dashboard and inventory show real alerts.
    const lowAtEnd =
      store.key === "downtown"
        ? ["LEMONADE", "BUN"]
        : store.key === "westside"
          ? ["CHK-FILLET"]
          : ["COLD-BREW"];
    // Alert items stay sellable during a live demo: they end with 30 servings of their largest use,
    // and their minimum is 1.6 x that, so the alert shows while the POS can still sell them.
    const servingQty = (sku) =>
      Math.max(
        0,
        ...PRODUCTS.filter((p) => store.products.includes(p.id)).flatMap((p) =>
          perServing(p)
            .filter(([k]) => k === sku)
            .map(([, q]) => q),
        ),
      );
    const alertKeep = Object.fromEntries(
      lowAtEnd.map((sku) => [sku, Math.ceil(servingQty(sku) * 30 * 100) / 100]),
    );
    const boundaries = [startYmd, ...receiptDays, addDays(todayYmd, 1)];
    const opening = {};
    const receipts = [];
    for (const s of STOCK) {
      const need0 = consumption(boundaries[0], boundaries[1]).get(s.sku) ?? 0;
      opening[s.sku] = roundUp(need0 * 1.15 + avgDaily(s.sku) * 2, s.pack);
    }
    let balance = { ...opening };
    for (let k = 0; k < receiptDays.length; k++) {
      const used = consumption(boundaries[k], boundaries[k + 1]);
      for (const s of STOCK) balance[s.sku] -= used.get(s.sku) ?? 0;
      const next = consumption(boundaries[k + 1], boundaries[k + 2]);
      const last = k === receiptDays.length - 1;
      const lines = [];
      for (const s of STOCK) {
        const target =
          (next.get(s.sku) ?? 0) * 1.12 +
          (last && lowAtEnd.includes(s.sku) ? alertKeep[s.sku] : avgDaily(s.sku) * (last ? 5 : 2));
        const missing = target - balance[s.sku];
        if (missing > 0 && avgDaily(s.sku) > 0) {
          // The chosen alert items get exactly what they miss in the last order (no pack rounding),
          // so they end below their minimum; everything else is ordered in whole packs.
          const exact = last && lowAtEnd.includes(s.sku);
          const q = exact ? Math.ceil(missing * 100) / 100 : roundUp(missing, s.pack);
          lines.push({ sku: s.sku, quantity: q, unitPriceCents: s.costCents });
          balance[s.sku] += q;
        }
      }
      if (!lines.length) continue;
      const bySupplier = new Map();
      for (const l of lines) {
        const sup = stockBySku[l.sku].supplier;
        bySupplier.set(sup, [...(bySupplier.get(sup) ?? []), l]);
      }
      for (const [supplier, items] of bySupplier) {
        const orderedAt = zonedInstant(addDays(receiptDays[k], -2), 10, 15);
        const receivedAt = zonedInstant(receiptDays[k], 8, 0);
        receipts.push({
          key: `${store.key}-${receiptDays[k]}-${supplier}`,
          supplier,
          orderedAt,
          receivedAt,
          items,
        });
      }
    }
    const used = consumption(boundaries[receiptDays.length], boundaries[receiptDays.length + 1]);
    for (const s of STOCK) balance[s.sku] -= used.get(s.sku) ?? 0;
    // One open purchase order (sent, not received) per store for the purchasing screen.
    const openPo = {
      key: `${store.key}-open`,
      supplier: "produce",
      items: ["LETTUCE", "TOMATO", "FRIES"].map((sku) => ({
        sku,
        quantity: stockBySku[sku].pack * 2,
        unitPriceCents: stockBySku[sku].costCents,
      })),
    };
    stockPlan[store.key] = {
      opening,
      receipts,
      openPo,
      // Minimum = two days of this store's average use (0 for items it never uses); alert items:
      // 1.6 x what they keep, so they show as low while staying sellable.
      minQuantity: Object.fromEntries(
        STOCK.map((s) => {
          const base =
            avgDaily(s.sku) > 0 ? Math.max(0.1, Math.round(avgDaily(s.sku) * 2 * 100) / 100) : 0;
          return [
            s.sku,
            s.sku in alertKeep ? Math.max(base, Math.ceil(alertKeep[s.sku] * 160) / 100) : base,
          ];
        }),
      ),
      expectedFinal: balance,
      lowAtEnd,
      alertKeep,
    };
    for (const rc of receipts)
      events.push({ kind: "receipt", store: store.key, at: rc.receivedAt, receipt: rc });
    for (const s of store.sales) events.push({ kind: "sale", store: store.key, at: s.at, sale: s });
    for (const s of store.openTickets)
      events.push({ kind: "sale", store: store.key, at: s.at, sale: s });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === "receipt" ? -1 : 1));

  // Expenses: previous and current month per store.
  const expenses = [];
  const months = [addDays(todayYmd, -32).slice(0, 7), todayYmd.slice(0, 7)];
  for (const store of STORES) {
    const e = EXPENSES[store.key];
    for (const month of [...new Set(months)]) {
      const items = [
        ["rent", "fixed", e.rent, `${month}-01`, "Store lease"],
        ["payroll", "recurring", Math.round(e.payroll / 2), `${month}-14`, "Payroll, first half"],
        ["payroll", "recurring", Math.round(e.payroll / 2), `${month}-28`, "Payroll, second half"],
        ["energy", "variable", e.energy, `${month}-10`, "Electricity"],
        ["water", "variable", e.water, `${month}-12`, "Water and sewer"],
        ["internet", "fixed", e.internet, `${month}-05`, "Internet and POS network"],
        ["marketing", "variable", e.marketing, `${month}-20`, "Local marketing"],
      ];
      for (const [category, recurrence, amountCents, dueDate, description] of items) {
        const past = dueDate < todayYmd;
        const overdue =
          past && store.key === "westside" && category === "energy" && month === months[1];
        expenses.push({
          store: store.key,
          payload: {
            category,
            recurrence,
            status: overdue ? "overdue" : past ? "paid" : "pending",
            description: `${description} — ${store.name}`,
            amountCents,
            dueDate,
            competencyDate: `${month}-01`,
            responsiblePerson: "Demo Owner",
            supplierName: "",
            ...(past && !overdue ? { paidAt: dueDate } : {}),
            isSimulation: false,
          },
        });
      }
    }
  }

  const summary = {
    stores: stores.map((s) => ({
      key: s.key,
      sales: s.sales.length,
      openTickets: s.openTickets.length,
    })),
    orders: stores.reduce((n, s) => n + s.sales.length + s.openTickets.length, 0),
    cancelled: stores.reduce(
      (n, s) => n + s.sales.filter((x) => x.steps.some((st) => st.status === "cancelled")).length,
      0,
    ),
    receipts: Object.values(stockPlan).reduce((n, p) => n + p.receipts.length, 0),
    expenses: expenses.length,
    days,
    profile,
  };
  // Ledger rows the app will read: revenue + COGS per sale, both again for a cancellation, one per receipt.
  summary.ledgerEntries = 2 * summary.orders + 2 * summary.cancelled + summary.receipts;
  return {
    version: DATASET_VERSION,
    seed,
    now,
    startYmd,
    todayYmd,
    openingsAt,
    stores,
    stockPlan,
    events,
    expenses,
    summary,
  };
}
