import { BILLING, comparison, formatUsd, getComparison, getPlans, periodPrice, plans } from "../config/pricing";

describe("pricing configuration", () => {
  it("defines exactly the three approved plans in order", () => {
    expect(plans.map((p) => p.id)).toEqual(["starter", "growth", "enterprise"]);
  });

  it("keeps the approved monthly prices and implementation fees", () => {
    const [starter, growth, enterprise] = plans;
    expect(starter?.monthly).toEqual({ kind: "fixed", amountUsd: 69 });
    expect(starter?.implementation).toEqual({ kind: "fixed", amountUsd: 149 });
    expect(growth?.monthly).toEqual({ kind: "fixed", amountUsd: 119 });
    expect(growth?.implementation).toEqual({ kind: "fixed", amountUsd: 399.99 });
    expect(enterprise?.monthly.kind).toBe("custom");
    expect(enterprise?.implementation).toMatchObject({ kind: "startingAt", amountUsd: 799 });
  });

  it("marks only Growth as Most Popular", () => {
    expect(plans.filter((p) => p.highlight).map((p) => p.id)).toEqual(["growth"]);
    expect(plans.find((p) => p.id === "growth")?.highlight).toBe("Most Popular");
  });

  it("keeps the comparison table consistent with plan prices", () => {
    const basics = comparison[0]?.rows ?? [];
    expect(basics.find((r) => r.label === "Monthly subscription")?.values).toEqual({
      starter: "$69 / mo",
      growth: "$119 / mo",
      enterprise: "Custom",
    });
    expect(basics.find((r) => r.label === "One-time implementation")?.values).toEqual({
      starter: "$149",
      growth: "$399.99",
      enterprise: "From $799",
    });
  });

  it("formats USD with cents only when there are any", () => {
    expect(formatUsd(69)).toBe("$69");
    expect(formatUsd(1199)).toBe("$1,199");
    expect(formatUsd(399.99)).toBe("$399.99");
    expect(formatUsd(499.99, "pt").replace(/\s+/g, " ")).toBe("US$ 499,99");
  });

  it("does not advertise discounts or per-location surcharges", () => {
    const text = JSON.stringify(plans).toLowerCase();
    expect(text).not.toMatch(/discount|% off|per additional location|free trial/);
  });
});

describe("pricing in Portuguese", () => {
  const norm = (v: unknown) => String(v).replace(/\s+/g, " ");

  it("uses the same amounts, shown in US dollars", () => {
    const amounts = (l: "en" | "pt") =>
      getPlans(l).map((p) => [p.id, p.monthly.kind === "fixed" ? p.monthly.amountUsd : "custom", p.implementation.amountUsd]);
    expect(amounts("pt")).toEqual(amounts("en"));

    const basics = getComparison("pt")[0]?.rows ?? [];
    const monthly = basics.find((r) => r.label === "Assinatura mensal")?.values;
    expect(norm(monthly?.starter)).toBe("US$ 69/mês");
    expect(norm(monthly?.growth)).toBe("US$ 119/mês");
    const impl = basics.find((r) => r.label === "Implantação (pagamento único)")?.values;
    expect(norm(impl?.starter)).toBe("US$ 149");
    expect(norm(impl?.growth)).toBe("US$ 399,99");
    expect(norm(impl?.enterprise)).toBe("A partir de US$ 799");
    expect(getPlans("pt").find((p) => p.id === "growth")?.highlight).toBe("Mais popular");
  });

  it("keeps rolling-out flags and plan inclusions identical in both languages", () => {
    const flags = (l: "en" | "pt") => getPlans(l).map((p) => p.features.map((f) => Boolean(f.rollingOut)));
    expect(flags("pt")).toEqual(flags("en"));
    const rows = (l: "en" | "pt") =>
      getComparison(l).flatMap((g) => g.rows.map((r) => [Boolean(r.rollingOut), r.values.starter === true, r.values.growth === true]));
    expect(rows("pt")).toEqual(rows("en"));
  });
});

describe("billing periods", () => {
  it("discounts only longer, upfront periods: 8% every 6 months, 15% yearly", () => {
    expect(BILLING.monthly).toEqual({ months: 1, discount: 0 });
    expect(BILLING.semiannual).toEqual({ months: 6, discount: 0.08 });
    expect(BILLING.annual).toEqual({ months: 12, discount: 0.15 });
  });

  it("charges whole dollars for the period and derives the monthly equivalent", () => {
    expect(periodPrice(69, "monthly")).toMatchObject({ charge: 69, perMonth: 69, savings: 0 });
    expect(periodPrice(69, "semiannual")).toMatchObject({ charge: 381, perMonth: 63.5, savings: 33 });
    expect(periodPrice(69, "annual")).toMatchObject({ charge: 704, perMonth: 58.67, savings: 124 });
    expect(periodPrice(119, "semiannual")).toMatchObject({ charge: 657, perMonth: 109.5, savings: 57 });
    expect(periodPrice(119, "annual")).toMatchObject({ charge: 1214, perMonth: 101.17, savings: 214 });
  });

  it("never discounts the implementation fee", () => {
    const [starter, growth] = plans;
    expect(starter?.implementation).toEqual({ kind: "fixed", amountUsd: 149 });
    expect(growth?.implementation).toEqual({ kind: "fixed", amountUsd: 399.99 });
  });
});
