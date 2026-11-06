import { describe, it, expect } from "vitest";
import {
  computeIntelligenceSummary,
  executeAgentQuery,
  classifyQueryTopic,
} from "@/lib/intelligence-service";

describe("Servora Intelligence Service (Deterministic Logic)", () => {
  const orgId = "org-demo-1";

  it("calculates intelligence metrics without throwing", () => {
    const summary = computeIntelligenceSummary(orgId, "all", 30);
    expect(summary).toBeDefined();
    expect(summary.grossRevenueCents).toBeGreaterThanOrEqual(0);
    expect(summary.foodCostCents).toBeGreaterThanOrEqual(0);
    expect(summary.cmvRate).toBeGreaterThanOrEqual(0);
    expect(summary.cmvRate).toBeLessThanOrEqual(100);
    expect(Array.isArray(summary.insights)).toBe(true);
  });

  it("generates insights with explicit confidence and data origin metadata", () => {
    const summary = computeIntelligenceSummary(orgId, "all", 30);
    expect(summary.insights.length).toBeGreaterThan(0);

    summary.insights.forEach((ins) => {
      expect(ins.id).toBeDefined();
      expect(ins.title).toBeTruthy();
      expect(ins.summary).toBeTruthy();
      expect(["high", "medium", "low", "opportunity"]).toContain(ins.impactLevel);
      expect(["deterministic", "statistical_high", "statistical_medium"]).toContain(ins.confidence);
      expect(["real_recorded", "mixed_verified", "sample_simulated"]).toContain(ins.dataOrigin);
      expect(ins.recommendation).toBeTruthy();
    });
  });

  it("isolates locations and aggregates correctly", () => {
    const allSummary = computeIntelligenceSummary(orgId, "all", 30);
    const singleLocSummary = computeIntelligenceSummary(orgId, "loc-non-existent", 30);

    expect(singleLocSummary.grossRevenueCents).toBeLessThanOrEqual(allSummary.grossRevenueCents);
  });

  it("correctly classifies query topics deterministically", () => {
    expect(classifyQueryTopic("qual o cmv de alimentos?")).toBe("cmv");
    expect(classifyQueryTopic("quanto gastei em compras com fornecedores?")).toBe("suppliers");
    expect(classifyQueryTopic("qual foi o descarte e perda?")).toBe("waste");
    expect(classifyQueryTopic("qual faturamento bruto das vendas?")).toBe("sales");
  });

  it("executes agent queries with deterministic routing and full executive breakdown", () => {
    const responseCmv = executeAgentQuery("Qual o meu CMV atual?", orgId, "all", 30);
    expect(responseCmv.topic).toBe("cmv");
    expect(responseCmv.deterministicEngine).toBe(true);
    expect(responseCmv.report.numericEvidence.length).toBeGreaterThan(0);
    expect(responseCmv.report.practicalRecommendations.length).toBeGreaterThan(0);
    expect(responseCmv.report.limitations.length).toBeGreaterThan(0);
    expect(responseCmv.report.calculationExplanation).toBeTruthy();

    const responseWaste = executeAgentQuery(
      "Quanto foi perdido com desperdício e descarte?",
      orgId,
      "all",
      30,
    );
    expect(responseWaste.topic).toBe("waste");
    expect(
      responseWaste.report.numericEvidence.some((e) => e.label.includes("Perda Estimada")),
    ).toBe(true);

    const responseSuppliers = executeAgentQuery(
      "Como estão os fornecedores e ordens de compra?",
      orgId,
      "all",
      30,
    );
    expect(responseSuppliers.topic).toBe("suppliers");
  });
});
