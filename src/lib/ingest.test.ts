import { describe, it, expect } from "vitest";
import { parseCsv } from "./ingest";

describe("parseCsv", () => {
  it("parses rows keyed by header", () => {
    const rows = parseCsv("id_child,removal_date\n1,2024-01-01\n2,2024-02-01");
    expect(rows).toEqual([
      { id_child: "1", removal_date: "2024-01-01" },
      { id_child: "2", removal_date: "2024-02-01" },
    ]);
  });

  it("normalizes headers: trims, lowercases, and spaces become underscores", () => {
    const rows = parseCsv(" ID Child , Removal Date \n1,2024-01-01");
    expect(rows[0]).toEqual({ id_child: "1", removal_date: "2024-01-01" });
  });

  it("skips blank lines (source CSVs commonly have trailing blank rows)", () => {
    const rows = parseCsv("id_child,removal_date\n1,2024-01-01\n\n\n2,2024-02-01\n");
    expect(rows).toEqual([
      { id_child: "1", removal_date: "2024-01-01" },
      { id_child: "2", removal_date: "2024-02-01" },
    ]);
  });

  it("throws on a genuinely malformed CSV", () => {
    // An unterminated quote is a real parse failure, not just a ragged row.
    expect(() => parseCsv('id_child,note\n1,"unterminated')).toThrow(/CSV parse failed/);
  });
});
