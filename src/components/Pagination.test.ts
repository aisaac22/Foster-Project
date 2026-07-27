import { describe, it, expect } from "vitest";
import { parsePage } from "./Pagination";

describe("parsePage", () => {
  it("defaults to 1 when missing", () => {
    expect(parsePage(undefined)).toBe(1);
  });
  it("parses a valid page number", () => {
    expect(parsePage("7")).toBe(7);
  });
  it("rejects zero, negative, and non-integer values back to 1", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-5")).toBe(1);
    expect(parsePage("3.5")).toBe(1);
  });
  it("rejects garbage input back to 1, rather than NaN leaking into a query", () => {
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("")).toBe(1);
  });
});
