import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

interface GapRow {
  county: string;
  county_id: number;
  age_band: string;
  sort_order: number;
  children_in_band: number;
  homes_accepting_band: number;
  homes_available_now: number;
  children_per_accepting_home: number | null;
  unmet_need_estimate: number;
}

// Color a cell by how strained that county x age-band is: children per
// accepting home. Green = supply, red = shortage.
function cellColor(ratio: number | null, children: number): string {
  if (children === 0) return "transparent";
  if (ratio === null) return "#b91c1c";
  if (ratio <= 1) return "#dcfce7";
  if (ratio <= 2) return "#fef9c3";
  if (ratio <= 4) return "#fed7aa";
  return "#fecaca";
}

export default async function RecruitmentPage() {
  await requireUser();

  const rows = await query<GapRow>(`
    select county, county_id, age_band, sort_order,
           children_in_band, homes_accepting_band, homes_available_now,
           children_per_accepting_home, unmet_need_estimate
    from v_age_capacity_gap
    order by sort_order
  `);

  // Distinct age bands in display order (columns).
  const bands: string[] = [];
  const bandOrder = new Map<string, number>();
  for (const r of rows) {
    if (!bandOrder.has(r.age_band)) {
      bandOrder.set(r.age_band, r.sort_order);
      bands.push(r.age_band);
    }
  }
  bands.sort((a, b) => bandOrder.get(a)! - bandOrder.get(b)!);

  // Group by county; compute each county's total unmet need for row ordering.
  const byCounty = new Map<string, Map<string, GapRow>>();
  const countyNeed = new Map<string, number>();
  for (const r of rows) {
    if (!byCounty.has(r.county)) byCounty.set(r.county, new Map());
    byCounty.get(r.county)!.set(r.age_band, r);
    countyNeed.set(
      r.county,
      (countyNeed.get(r.county) ?? 0) + Number(r.unmet_need_estimate),
    );
  }

  const counties = [...byCounty.keys()]
    .filter((c) => (countyNeed.get(c) ?? 0) > 0)
    .sort((a, b) => countyNeed.get(b)! - countyNeed.get(a)!);

  return (
    <>
      <h1>Recruitment — age &amp; capacity gaps</h1>
      <p className="subtitle">
        Each cell is a county and age band: the ratio of children currently in
        care to the foster homes whose stated preferences accept that age. Red
        cells are where children need placement and too few homes will take them
        — your recruitment targets. Counties are ordered by total unmet need.
        Age preferences reflect each home&apos;s current stated range, so this is
        a forward-looking guide, not a record of past matching.
      </p>

      {counties.length === 0 ? (
        <p className="empty">No capacity gaps to show yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table matrix">
            <thead>
              <tr>
                <th>County</th>
                {bands.map((b) => (
                  <th key={b} className="num" style={{ minWidth: 92 }}>
                    {b}
                  </th>
                ))}
                <th className="num">Total gap</th>
              </tr>
            </thead>
            <tbody>
              {counties.map((county) => {
                const cells = byCounty.get(county)!;
                return (
                  <tr key={county}>
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {county}
                    </td>
                    {bands.map((b) => {
                      const cell = cells.get(b);
                      const children = cell ? Number(cell.children_in_band) : 0;
                      const ratio = cell
                        ? cell.children_per_accepting_home === null
                          ? null
                          : Number(cell.children_per_accepting_home)
                        : 0;
                      return (
                        <td
                          key={b}
                          className="num"
                          style={{ background: cellColor(ratio, children) }}
                          title={
                            cell
                              ? `${children} children · ${cell.homes_accepting_band} homes accept this age · ${cell.homes_available_now} open now`
                              : "no data"
                          }
                        >
                          {children === 0 ? (
                            <span style={{ color: "#cbd5e1" }}>·</span>
                          ) : ratio === null ? (
                            <strong>{children}:0</strong>
                          ) : (
                            ratio.toFixed(1)
                          )}
                        </td>
                      );
                    })}
                    <td className="num" style={{ fontWeight: 700 }}>
                      {Math.round(countyNeed.get(county) ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="meta" style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
        <span>Cell = children per accepting home.</span>
        <LegendSwatch color="#dcfce7" label="≤1 (ok)" />
        <LegendSwatch color="#fef9c3" label="1–2" />
        <LegendSwatch color="#fed7aa" label="2–4" />
        <LegendSwatch color="#fecaca" label="4+ (severe)" />
        <LegendSwatch color="#b91c1c" label="children, no homes" />
        <span>Hover a cell for detail. &quot;15:0&quot; = 15 children, zero accepting homes.</span>
      </div>
    </>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span
        style={{
          width: 14,
          height: 14,
          background: color,
          border: "1px solid var(--line)",
          borderRadius: 3,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
