import { describe, expect, it } from "vitest";
import { centsToValue, formatMoney, valueToCents } from "@/lib/money";

describe("valueToCents", () => {
  it("parses PayPal decimal strings and plain numbers", () => {
    expect(valueToCents("20.00")).toBe(2000);
    expect(valueToCents("20")).toBe(2000);
    expect(valueToCents("20.5")).toBe(2050);
    expect(valueToCents("0.05")).toBe(5);
    expect(valueToCents(20)).toBe(2000);
  });

  it("rejects negatives, sub-cent precision and junk", () => {
    expect(() => valueToCents("-1")).toThrow();
    expect(() => valueToCents("1.234")).toThrow();
    expect(() => valueToCents("abc")).toThrow();
    expect(() => valueToCents("")).toThrow();
  });
});

describe("centsToValue", () => {
  it("formats cents as a two-decimal string", () => {
    expect(centsToValue(2000)).toBe("20.00");
    expect(centsToValue(5)).toBe("0.05");
    expect(centsToValue(0)).toBe("0.00");
  });

  it("refuses non-integer or negative cents", () => {
    expect(() => centsToValue(20.5)).toThrow();
    expect(() => centsToValue(-1)).toThrow();
  });
});

describe("formatMoney", () => {
  it("formats USD for display", () => {
    expect(formatMoney(2000)).toBe("$20.00");
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
});
