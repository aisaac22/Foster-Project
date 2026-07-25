import Link from "next/link";
import { query } from "@/lib/db";
import { pct, oneDp, riskLevel } from "@/lib/format";
import { requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic"; // always read live from the DB

interface Row {
  id_provider: string;
  county: string | null;
  tenure_years: number;
  n_placements: number;
  utilization_rate: number;
  disruption_rate: number | null;
  days_idle: number;
  has_child_now: boolean;
  risk_score: number;
}

/**
 * Reconstruct the human-readable reasons a home scored high. The score itself
 * is continuous; these flags tell a caseworker *why* to call — a worklist
 * without reasons doesn't get worked.
 */
function reasons(r: Row): string[] {
  const out: string[] = [];
  const util = Number(r.utilization_rate);
  const disrupt = Number(r.disruption_rate ?? 0);
  const tenure = Number(r.tenure_years);
  const idle = Number(r.days_idle);
  if (util < 0.25) out.push("Low utilization");
  if (disrupt > 0.4 && r.n_placements >= 2) out.push("High disruption");
  if (tenure < 2) out.push("New home");
  if (!r.has_child_now && idle > 180) out.push("Idle 6mo+");
  return out;
}

export default async function AtRiskPage() {
  await requireUser();
  const rows = await query<Row>(`
    select id_provider, county, tenure_years, n_placements,
           utilization_rate, disruption_rate, days_idle, has_child_now,
           risk_score
    from v_provider_at_risk
    order by risk_score desc
    limit 100
  `);

  return (
    <>
      <h1>At-risk homes</h1>
      <p className="subtitle">
        Currently licensed foster homes ranked by likelihood of exiting, based on
        utilization relative to peers, disruption rate, and tenure. Homes near the
        top are still active and reachable — a retention contact now is cheaper
        than recruiting a replacement.
      </p>

      {rows.length === 0 ? (
        <p className="empty">
          No homes to show. Load data with the ingest script, then refresh.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Home</th>
              <th>County</th>
              <th className="num">Tenure</th>
              <th className="num">Placements</th>
              <th className="num">Utilization</th>
              <th className="num">Disruption</th>
              <th>Why flagged</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const level = riskLevel(r.risk_score);
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
                  <td className="num">{pct(r.disruption_rate)}</td>
                  <td>
                    <div className="flags">
                      {reasons(r).map((f) => (
                        <span className="flag" key={f}>{f}</span>
                      ))}
                    </div>
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
                      <span className="score-val">{Math.round(r.risk_score)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="meta">Showing top {rows.length} of currently licensed homes.</p>
    </>
  );
}
