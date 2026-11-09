import { describe, it, expect } from "vitest";
import {
  calculateDreStatement,
  calculateProductMargins,
  calculateCategoryMargins,
  computeFinanceSummary,
  compareStoreFinancials,
  formatUsd,
  generateFinancialReport,
  exportReportToCsv,
  exportReportToXmlSpreadsheet,
  type Expense,
} from "@/lib/finance-service";

describe("Finance Service - DRE, Margins & Cash Accounting", () => {
  const sampleExpenses: Expense[] = [
    {
      id: "e1",
      orgId: "org-test",
      locationId: "loc-1",
      category: "rent",
      recurrence: "fixed",
      status: "paid",
      description: "Rent lease",
      amountCents: 500000, // $5,000
      currency: "usd",
      dueDate: "2025-05-01",
      competencyDate: "2025-05-01",
      responsiblePerson: "Manager",
      isSimulation: false,
      createdAt: "2025-05-01",
      updatedAt: "2025-05-01",
    },
    {
      id: "e2",
      orgId: "org-test",
      locationId: "loc-1",
      category: "payroll",
      recurrence: "variable",
      status: "pending",
      description: "Shift payroll",
      amountCents: 300000, // $3,000
      currency: "usd",
      dueDate: "2025-05-15",
      competencyDate: "2025-05-01",
      responsiblePerson: "HR",
      isSimulation: false,
      createdAt: "2025-05-01",
      updatedAt: "2025-05-01",
    },
    {
      id: "e3",
      orgId: "org-test",
      locationId: "loc-1",
      category: "ingredients", // COGS item excluded from OpEx
      recurrence: "variable",
      status: "paid",
      description: "Cheese bulk restock",
      amountCents: 100000, // $1,000
      currency: "usd",
      dueDate: "2025-05-10",
      competencyDate: "2025-05-01",
      responsiblePerson: "Sous Chef",
      isSimulation: false,
      createdAt: "2025-05-01",
      updatedAt: "2025-05-01",
    },
  ];

  it("calculates DRE statement correctly with deductions and OpEx", () => {
    const grossRevenue = 2000000; // $20,000
    const discounts = 100000; // $1,000
    const taxes = 150000; // $1,500
    const cogs = 500000; // $5,000 (25%)

    const dre = calculateDreStatement(grossRevenue, discounts, taxes, cogs, sampleExpenses, 0);

    // Net Revenue = 20,000 - 1,000 - 1,500 = 17,500 ($17,500.00)
    expect(dre.netRevenueCents).toBe(1750000);
    // Gross Profit = 17,500 - 5,000 = 12,500
    expect(dre.grossProfitCents).toBe(1250000);
    // Gross Margin % = (12,500 / 17,500) * 100 = 71.43%
    expect(dre.grossMarginPct).toBeCloseTo(71.43, 1);
    // OpEx must exclude ingredient category: fixed rent (5,000) + variable payroll (3,000) = 8,000
    expect(dre.operatingExpensesCents).toBe(800000);
    // Operating Profit = 12,500 - 8,000 = 4,500
    expect(dre.operatingProfitCents).toBe(450000);
    expect(dre.netMarginPct).toBeCloseTo((450000 / 1750000) * 100, 1);
  });

  it("triggers alerts when COGS is high (>35%) or margin low (<60%)", () => {
    const gross = 1000000; // $10,000
    const highCogs = 450000; // 45% of gross
    const dre = calculateDreStatement(gross, 0, 0, highCogs, [], 0);
    expect(dre.alertsCount).toBeGreaterThan(0);
  });

  it("calculates product margins and generates warnings accurately", () => {
    const products = [
      {
        id: "p1",
        name: "Burger",
        category: "Burgers",
        priceCents: 1500,
        recipeCostCents: 400,
        unitsSold: 10,
      },
      {
        id: "p2",
        name: "Steak",
        category: "Mains",
        priceCents: 3000,
        recipeCostCents: 1500,
        unitsSold: 5,
      }, // 50% cogs -> alert
    ];

    const margins = calculateProductMargins(products);
    expect(margins).toHaveLength(2);

    const burger = margins[0]!;
    expect(burger.revenueCents).toBe(15000);
    expect(burger.cogsCents).toBe(4000);
    expect(burger.grossProfitCents).toBe(11000);
    expect(burger.hasHighCostAlert).toBe(false);

    const steak = margins[1]!;
    expect(steak.hasHighCostAlert).toBe(true);
    expect(steak.hasLowMarginAlert).toBe(true);
  });

  it("aggregates category margins properly", () => {
    const metrics = [
      {
        productId: "p1",
        productName: "Classic",
        category: "Burgers",
        unitsSold: 2,
        revenueCents: 2000,
        cogsCents: 600,
        grossProfitCents: 1400,
        grossMarginPct: 70,
        cogsPct: 30,
        hasHighCostAlert: false,
        hasLowMarginAlert: false,
      },
      {
        productId: "p2",
        productName: "Bacon Double",
        category: "Burgers",
        unitsSold: 1,
        revenueCents: 1500,
        cogsCents: 450,
        grossProfitCents: 1050,
        grossMarginPct: 70,
        cogsPct: 30,
        hasHighCostAlert: false,
        hasLowMarginAlert: false,
      },
      {
        productId: "p3",
        productName: "Shake",
        category: "Drinks",
        unitsSold: 1,
        revenueCents: 500,
        cogsCents: 100,
        grossProfitCents: 400,
        grossMarginPct: 80,
        cogsPct: 20,
        hasHighCostAlert: false,
        hasLowMarginAlert: false,
      },
    ];

    const categories = calculateCategoryMargins(metrics);
    expect(categories).toHaveLength(2);

    const burgers = categories.find((c) => c.category === "Burgers");
    expect(burgers).toBeDefined();
    expect(burgers?.revenueCents).toBe(3500);
    expect(burgers?.cogsCents).toBe(1050);
    expect(burgers?.grossProfitCents).toBe(2450);
  });

  it("formats currency values accurately in USD", () => {
    expect(formatUsd(125000)).toBe("$1,250.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-5000)).toBe("-$50.00");
  });

  it("computes multi-store financial comparisons with ranks and benchmarks", () => {
    const storeA = {
      id: "loc-1",
      name: "Store Downtown",
      orders: [
        {
          id: "o1",
          totalCents: 1000000,
          discountCents: 0,
          taxCents: 50000,
          status: "delivered",
          isSimulated: false,
        },
        {
          id: "o2",
          totalCents: 500000,
          discountCents: 0,
          taxCents: 25000,
          status: "delivered",
          isSimulated: false,
        },
      ],
      expenses: [
        {
          id: "e1",
          orgId: "test",
          locationId: "loc-1",
          category: "rent" as const,
          recurrence: "fixed" as const,
          status: "paid" as const,
          description: "Rent",
          amountCents: 300000,
          currency: "usd" as const,
          dueDate: "2025-05-01",
          competencyDate: "2025-05-01",
          responsiblePerson: "Mgr",
          isSimulation: false,
          createdAt: "2025-05-01",
          updatedAt: "2025-05-01",
        },
      ],
    };

    const storeB = {
      id: "loc-2",
      name: "Store Midtown",
      orders: [
        {
          id: "o3",
          totalCents: 2000000,
          discountCents: 50000,
          taxCents: 100000,
          status: "delivered",
          isSimulated: false,
        },
      ],
      expenses: [
        {
          id: "e2",
          orgId: "test",
          locationId: "loc-2",
          category: "utilities" as const,
          recurrence: "fixed" as const,
          status: "paid" as const,
          description: "Electric",
          amountCents: 200000,
          currency: "usd" as const,
          dueDate: "2025-05-01",
          competencyDate: "2025-05-01",
          responsiblePerson: "Mgr",
          isSimulation: false,
          createdAt: "2025-05-01",
          updatedAt: "2025-05-01",
        },
      ],
    };

    const comparison = compareStoreFinancials([storeA, storeB]);
    expect(comparison.stores).toHaveLength(2);
    expect(comparison.benchmarkTotalGrossRevenueCents).toBe(3500000);
    expect(comparison.topRevenueStoreName).toBe("Store Midtown");

    const midtown = comparison.stores.find((s) => s.locationId === "loc-2");
    expect(midtown?.revenueRank).toBe(1);
    expect(midtown?.netProfitRank).toBe(1);
    expect(midtown?.isBestPerformer).toBe(true);
  });

  it("handles empty and inactive stores safely in multi-store comparison", () => {
    const emptyStore = {
      id: "loc-empty",
      name: "Unopened Branch",
      orders: [],
      expenses: [],
    };
    const comparison = compareStoreFinancials([emptyStore]);
    expect(comparison.stores).toHaveLength(1);
    expect(comparison.stores[0]?.status).toBe("empty");
    expect(comparison.stores[0]?.grossRevenueCents).toBe(0);
    expect(comparison.stores[0]?.netProfitRank).toBe(1);
  });

  it("generates financial reports and exports to CSV and Excel XML accurately", () => {
    const report = generateFinancialReport({
      filters: {
        reportType: "expenses",
        locationId: "loc-1",
        dataType: "all",
      },
      restaurantName: "Test Bistro",
      locationName: "Store Downtown",
      expenses: sampleExpenses,
      orders: [],
    });

    expect(report.title).toBe("Operating Expenses Detail");
    expect(report.currency).toBe("USD");
    expect(report.rows.length).toBeGreaterThanOrEqual(3);
    expect(report.totalOutflowCents).toBe(900000);

    const csv = exportReportToCsv(report);
    expect(csv).toContain("# Restaurant: Test Bistro");
    expect(csv).toContain("Rent lease");

    const xml = exportReportToXmlSpreadsheet(report);
    expect(xml).toContain('progid="Excel.Sheet"');
    expect(xml).toContain("Test Bistro");
  });
});
