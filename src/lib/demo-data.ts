import type { Location, Organization } from "./tenants";

/**
 * SYNTHETIC DEMO DATA. Deterministic per location so SSR and client match.
 * These numbers are illustrative only and never represent real customer data.
 */
export const DEMO_ANCHOR = new Date(Date.UTC(2026, 9, 22)); // last full demo day

function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export type DayPoint = {
  date: string;
  gross: number;
  orders: number;
  refunds: number;
  cancelled: number;
  discounts: number;
};

const cache = new Map<string, DayPoint[]>();

/** 180 days of daily figures for one location, ending at DEMO_ANCHOR. */
export function locationSeries(loc: Location): DayPoint[] {
  const hit = cache.get(loc.id);
  if (hit) return hit;
  const rand = seeded(loc.id);
  const out: DayPoint[] = [];
  for (let i = 179; i >= 0; i--) {
    const d = new Date(DEMO_ANCHOR.getTime() - i * 86400000);
    const dow = d.getUTCDay();
    const weekday = [1.18, 0.82, 0.86, 0.92, 1.0, 1.32, 1.4][dow]!;
    const trend = 1 + (179 - i) * 0.0009;
    const gross = 3900 * loc.demoScale * weekday * trend * (0.86 + rand() * 0.28);
    const aov = 22.5 + rand() * 4;
    const orders = Math.round(gross / aov);
    out.push({
      date: d.toISOString().slice(0, 10),
      gross,
      orders,
      refunds: gross * (0.004 + rand() * 0.01),
      cancelled: Math.round(orders * (0.008 + rand() * 0.015)),
      discounts: gross * (0.02 + rand() * 0.02),
    });
  }
  cache.set(loc.id, out);
  return out;
}

export type Kpis = {
  gross: number;
  net: number;
  orders: number;
  aov: number;
  growth: number;
  open: number;
  cancelled: number;
  refunds: number;
  foodCost: number;
  margin: number;
};

const FOOD_COST_RATE = 0.31; // assumption shown in UI

function sumRange(series: DayPoint[], days: number, offset = 0) {
  const slice = series.slice(series.length - days - offset, series.length - offset);
  return slice.reduce(
    (a, p) => ({
      gross: a.gross + p.gross,
      orders: a.orders + p.orders,
      refunds: a.refunds + p.refunds,
      cancelled: a.cancelled + p.cancelled,
      discounts: a.discounts + p.discounts,
    }),
    { gross: 0, orders: 0, refunds: 0, cancelled: 0, discounts: 0 },
  );
}

export function computeKpis(locs: Location[], days: number): Kpis {
  const cur = { gross: 0, orders: 0, refunds: 0, cancelled: 0, discounts: 0 };
  let prevGross = 0;
  locs.forEach((l) => {
    const s = locationSeries(l);
    const c = sumRange(s, days);
    (Object.keys(cur) as (keyof typeof cur)[]).forEach((k) => (cur[k] += c[k]));
    prevGross += sumRange(s, days, days).gross;
  });
  const net = cur.gross - cur.refunds - cur.discounts;
  const foodCost = net * FOOD_COST_RATE;
  return {
    gross: cur.gross,
    net,
    orders: cur.orders,
    aov: cur.gross / Math.max(cur.orders, 1),
    growth: prevGross ? (cur.gross - prevGross) / prevGross : 0,
    open: locs.reduce((a, l) => a + Math.round(6 * l.demoScale + 2), 0),
    cancelled: cur.cancelled,
    refunds: cur.refunds,
    foodCost,
    margin: (net - foodCost) / Math.max(net, 1),
  };
}

export function revenueSeries(locs: Location[], days: number) {
  const series = locs.map((l) => ({ id: l.id, s: locationSeries(l).slice(-days) }));
  const prev = locs.map((l) => locationSeries(l).slice(-days * 2, -days));
  return (series[0]?.s ?? []).map((p, i) => {
    const row: Record<string, number | string> = { date: p.date };
    let total = 0,
      prevTotal = 0;
    series.forEach(({ id, s }) => {
      const gross = s[i]?.gross ?? 0;
      row[id] = Math.round(gross);
      total += gross;
    });
    prev.forEach((s) => (prevTotal += s[i]?.gross ?? 0));
    row["total"] = Math.round(total);
    row["previous"] = Math.round(prevTotal);
    return row;
  });
}

export function hourlyMix(locs: Location[]) {
  const curve = [0, 0, 0.2, 0.9, 1.6, 1.3, 0.7, 0.5, 0.6, 1.0, 1.5, 1.7, 1.2, 0.7];
  const scale = locs.reduce((a, l) => a + l.demoScale, 0);
  return curve
    .map((v, i) => ({ hour: i + 10, orders: Math.round(v * 14 * scale) }))
    .filter((h) => h.hour >= 11);
}

export function channelMix(seed: string) {
  const r = seeded(seed);
  const dine = 0.34 + r() * 0.08,
    pickup = 0.36 + r() * 0.06;
  return [
    { key: "dineIn", value: dine },
    { key: "pickup", value: pickup },
    { key: "delivery", value: 1 - dine - pickup },
  ];
}

export function topItems(org: Organization, locs: Location[]) {
  if (!locs.length) return [];
  const r = seeded(org.id + locs.map((l) => l.id).join());
  const scale = locs.reduce((a, l) => a + l.demoScale, 0);
  let base = 190 * scale;
  return org.topItems
    .map((it) => {
      const qty = Math.round(base * (0.9 + r() * 0.2));
      base *= 0.78;
      return { name: it.name, qty, share: 0 };
    })
    .map((it, _, arr) => ({ ...it, share: it.qty / Math.max(arr[0]?.qty ?? 0, 1) }));
}

export type AlertKind =
  "lowInventory" | "delayedOrders" | "pendingApproval" | "salesVariation" | "missingClosing";

export function operationalAlerts(locs: Location[]) {
  if (!locs.length) return [];
  const kinds: { kind: AlertKind; severity: "high" | "medium" | "low"; count: number }[] = [
    { kind: "lowInventory", severity: "high", count: 4 },
    { kind: "delayedOrders", severity: "high", count: 2 },
    { kind: "pendingApproval", severity: "medium", count: 3 },
    { kind: "salesVariation", severity: "medium", count: 1 },
    { kind: "missingClosing", severity: "low", count: 1 },
  ];
  return kinds.flatMap((k, i) => {
    const location = locs[i % locs.length];
    return location ? [{ ...k, id: `al_${i}`, location }] : [];
  });
}

export const DEMO_ASSUMPTIONS = { foodCostRate: FOOD_COST_RATE };
