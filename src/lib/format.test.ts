import { describe, it, expect } from "vitest";
import { pct, num, oneDp, riskLevel } from "./format";

// Postgres numeric/bigint columns come back from `pg` as strings, so these
// helpers have to handle string input as the common case, not the exception.

describe("pct", () => {
  it("formats a fraction as a rounded percentage", () => {
    expect(pct(0.256)).toBe("26%");
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
  });
  it("coerces numeric strings, as returned by pg", () => {
    expect(pct("0.5")).toBe("50%");
  });
  it("renders an em dash for null/undefined/empty", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(pct("")).toBe("—");
  });
  it("renders an em dash for unparseable input", () => {
    expect(pct("not a number")).toBe("—");
  });
});

describe("num", () => {
  it("adds thousands separators", () => {
    expect(num(1234567)).toBe("1,234,567");
  });
  it("coerces numeric strings", () => {
    expect(num("42")).toBe("42");
  });
  it("renders an em dash for null/undefined/empty", () => {
    expect(num(null)).toBe("—");
    expect(num(undefined)).toBe("—");
    expect(num("")).toBe("—");
  });
});

describe("oneDp", () => {
  it("formats to one decimal place", () => {
    expect(oneDp(3.14159)).toBe("3.1");
    expect(oneDp(3)).toBe("3.0");
  });
  it("coerces numeric strings", () => {
    expect(oneDp("2.96")).toBe("3.0");
  });
  it("renders an em dash for null/undefined/empty", () => {
    expect(oneDp(null)).toBe("—");
    expect(oneDp(undefined)).toBe("—");
    expect(oneDp("")).toBe("—");
  });
});

describe("riskLevel", () => {
  it("buckets scores into the right label", () => {
    expect(riskLevel(90).label).toBe("High");
    expect(riskLevel(50).label).toBe("Elevated");
    expect(riskLevel(30).label).toBe("Watch");
    expect(riskLevel(10).label).toBe("Stable");
  });
  it("uses closed-lower-bound boundaries (>= not >)", () => {
    expect(riskLevel(65).label).toBe("High");
    expect(riskLevel(64.9).label).toBe("Elevated");
    expect(riskLevel(45).label).toBe("Elevated");
    expect(riskLevel(44.9).label).toBe("Watch");
    expect(riskLevel(25).label).toBe("Watch");
    expect(riskLevel(24.9).label).toBe("Stable");
  });
  it("treats missing/unparseable score as 0 (Stable), not a crash", () => {
    expect(riskLevel(null).label).toBe("Stable");
    expect(riskLevel(undefined).label).toBe("Stable");
    expect(riskLevel("garbage").label).toBe("Stable");
  });
});
