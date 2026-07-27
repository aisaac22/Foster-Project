import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { pct, oneDp, riskLevel } from "@/lib/format";
import { AtRiskFilters } from "./AtRiskFilters";
import { Pagination, parsePage, PAGE_SIZE } from "@/components/Pagination";

export const dynamic = "force-dynamic";

interface Row {
  id_provider: string;
  county: string | null;
  tenure_years: number;
  n_placements: number;
  utilization_rate: number;
  days_idle: number;
  has_child_now: boolean;
  never_placed: boolean;
  risk_score: number;
  last_contacted_at: string | null;
  last_outcome: string | null;
}

function reasons(r: Row): string[] {
  const out: string[] = [];
  const util = Number(r.utilization_rate);
  const idle = Number(r.days_idle);
  const tenure = Number(r.tenure_years);
  if (r.never_placed) out.push("Never placed");
  else if (util < 0.25) out.push("Low engagement");
  if (tenure < 2) out.push("New home");
  if (!r.has_child_now && idle > 180) out.push("Idle 6mo+");
  return out;
}

const OUTCOME_LABELS: Record<string, string> = {
  reached: "Reached",
  no_answer: "No answer",
  re_engaged: "Re-engaged",
  plans_to_close: "Plans to close",
  other: "Other",
};

const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function AtRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ county?: string; page?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const selectedCounty = sp.county?.trim() ?? "";
  const page = parsePage(sp.page);

  // County list for the dropdown.
  const countyRows = await query<{ county: string }>(`
    select distinct county
    from v_provider_at_risk
    where county is not null
    order by county
  `);
  const counties = countyRows.map((c) => c.county);

  // Total count for pagination (same filter, no rows fetched).
  const [{ total }] = await query<{ total: string }>(
    `select count(*)::int as total
     from v_provider_at_risk r
     where ($1 = '' or r.county = $1)`,
    [selectedCounty],
  );
  const totalRows = Number(total);
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  // The page of rows. county filter is a parameter; limit/offset are computed
  // numbers (safe to interpolate).
  const rows = await query<Row>(
    `
    select r.id_provider, r.county, r.tenure_years, r.n_placements,
           r.utilization_rate, r.days_idle, r.has_child_now, r.never_placed,
           r.risk_score,
           lc.last_contacted_at, lc.last_outcome
    from v_provider_at_risk r
    left join v_provider_last_contact lc using (id_provider)
    where ($1 = '' or r.county = $1)
    order by r.risk_score desc
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
  `,
    [selectedCounty],
  );

  return (
    <>
      <h1>At-risk homes</h1>
      <p className="subtitle">
        Currently licensed foster homes ranked by likelihood of disengaging or not
        renewing, based on how actively they take placements, days with a child
        placed, whether they have ever said yes, and how long they have been idle.
        Homes near the top are still licensed and reachable; a retention contact
        now is cheaper than recruiting a replacement.
      </p>

      <AtRiskFilters counties={counties} selectedCounty={selectedCounty} />

      {rows.length === 0 ? (
        <p className="empty">
          {selectedCounty
            ? `No at-risk homes in ${selectedCounty}.`
            : "No homes to show. Load data with the ingest script, then refresh."}
        </p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Home</th>
                <th>County</th>
                <th className="num">Tenure</th>
                <th className="num">Placements</th>
                <th className="num">Utilization</th>
                <th>Why flagged</th>
                <th>Last contact</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const level = riskLevel(r.risk_score);
                const contacted = r.last_contacted_at
                  ? new Date(r.last_contacted_at)
                  : null;
                const daysSince = contacted
                  ? Math.floor((Date.now() - contacted.getTime()) / 86_400_000)
                  : null;
                const recent = daysSince !== null && daysSince <= 14;
                return (
                  <tr key={r.id_provider}>
                    <td>
                      <Link href={`/providers/${r.id_provider}`}>
                        #{r.id_provider}
                      </Link>
                    </td>
                    <td>{r.county ?? "—"}</td>
                    <td className="num">{oneDp(r.tenure_years)}y</td>
                    <td className="num">{r.n_placements}</td>
                    <td className="num">{pct(r.utilization_rate)}</td>
                    <td>
                      <div className="flags">
                        {reasons(r).map((f) => (
                          <span className="flag" key={f}>{f}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {contacted ? (
                        <span
                          className={`contacted-tag ${recent ? "contacted-recent" : ""}`}
                        >
                          {fmtWhen(r.last_contacted_at!)}
                          {r.last_outcome
                            ? ` · ${OUTCOME_LABELS[r.last_outcome] ?? r.last_outcome}`
                            : ""}
                        </span>
                      ) : (
                        <span className="contacted-tag">—</span>
                      )}
                    </td>
                    <td>
                      <div className="score-cell">
                        <div className="score-bar">
                          <div
                            className="score-fill"
                            style={{
                              width: `${Math.min(100, Number(r.risk_score))}%`,
                              background: level.color,
                            }}
                          />
                        </div>
                        <span className="score-val">
                          {Math.round(Number(r.risk_score))}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Pagination
            basePath="/at-risk"
            page={page}
            totalPages={totalPages}
            params={selectedCounty ? { county: selectedCounty } : {}}
          />
        </>
      )}

      <p className="meta">
        {totalRows} homes{selectedCounty ? ` in ${selectedCounty}` : ""} · page{" "}
        {page} of {Math.max(1, totalPages)}
      </p>
    </>
  );
}
