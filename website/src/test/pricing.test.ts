import { comparison, formatUsd, getComparison, getPlans, plans } from "../config/pricing";

describe("pricing configuration", () => {
  it("defines exactly the three approved plans in order", () => {
    expect(plans.map((p) => p.id)).toEqual(["starter", "growth", "enterprise"]);
  });

  it("keeps the approved monthly prices and implementation fees", () => {
    const [starter, growth, enterprise] = plans;
    expect(starter?.monthly).toEqual({ kind: "fixed", amountUsd: 49 });
    expect(starter?.implementation).toEqual({ kind: "fixed", amountUsd: 149 });
    expect(growth?.monthly).toEqual({ kind: "fixed", amountUsd: 119 });
    expect(growth?.implementation).toEqual({ kind: "fixed", amountUsd: 349 });
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
      starter: "$49 / mo",
      growth: "$119 / mo",
      enterprise: "Custom",
    });
    expect(basics.find((r) => r.label === "One-time implementation")?.values).toEqual({
      starter: "$149",
      growth: "$349",
      enterprise: "From $799",
    });
  });

  it("formats USD without cents", () => {
    expect(formatUsd(49)).toBe("$49");
    expect(formatUsd(1199)).toBe("$1,199");
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
    expect(norm(monthly?.starter)).toBe("US$ 49/mês");
    expect(norm(monthly?.growth)).toBe("US$ 119/mês");
    const impl = basics.find((r) => r.label === "Implantação (pagamento único)")?.values;
    expect(norm(impl?.starter)).toBe("US$ 149");
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
