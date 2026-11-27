import { describe, expect, it } from "vitest";
import { fmtMoneyAxis } from "@/lib/format";

// Intl may put a narrow no-break space between the currency and the number.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("chart axis money labels", () => {
  it("writes small amounts out in whole dollars (no browser-dependent compact words)", () => {
    expect(plain(fmtMoneyAxis(200_000, "pt-BR"))).toBe("US$ 2.000");
    expect(plain(fmtMoneyAxis(100_000, "pt-BR"))).toBe("US$ 1.000");
    expect(plain(fmtMoneyAxis(0, "pt-BR"))).toBe("US$ 0");
    expect(fmtMoneyAxis(200_000, "en-US")).toBe("$2,000");
    expect(fmtMoneyAxis(12_345_67, "en-US")).toBe("$12,346");
  });
  it("uses the compact form from a million dollars up", () => {
    expect(fmtMoneyAxis(250_000_000, "en-US")).toBe("$2.5M");
  });
});
