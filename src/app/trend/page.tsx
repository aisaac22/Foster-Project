import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { num } from "@/lib/format";
import { TrendChart } from "./TrendChart";

export const dynamic = "force-dynamic";

interface MonthlyRow {
  month: string;
  homes_licensed: number;
  homes_exited: number;
  homes_active_eom: number;
}

const fmtMonth = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default async function TrendPage() {
  await requireUser();

  // Excludes the current, still-in-progress month — its "active at month end"
  // figure is computed against a future date and reads as a misleading cliff
  // until the month actually finishes.
  const rows = await query<MonthlyRow>(`
    select month, sum(homes_licensed)::int as homes_licensed,
           sum(homes_exited)::int as homes_exited,
           sum(homes_active_eom)::int as homes_active_eom
    from v_provider_churn_monthly
    where month < date_trunc('month', current_snapshot_date())
    group by month
    order by month
  `);

  const tableRows = [...rows].reverse().slice(0, 5);

  return (
    <>
      <h1>Monthly trend</h1>
      <p className="subtitle">
        Licensed homes gained, lost, and active at month end, across all
        counties. The clearest read on whether recruitment is keeping pace
        with retention losses over time.
      </p>

      {rows.length === 0 ? (
        <p className="empty">No monthly data yet.</p>
      ) : (
        <>
          <TrendChart data={rows} />

          <h2 style={{ fontSize: "1.1rem", margin: "2rem 0 0.75rem" }}>
            Monthly detail (last 5 months)
          </h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">New licenses</th>
                <th className="num">Exits</th>
                <th className="num">Active (month end)</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.month}>
                  <td>{fmtMonth(r.month)}</td>
                  <td className="num">{num(r.homes_licensed)}</td>
                  <td className="num">{num(r.homes_exited)}</td>
                  <td className="num">{num(r.homes_active_eom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ fontSize: "1.1rem", margin: "2.5rem 0 0.5rem" }}>
        Federal context
      </h2>
      <p className="subtitle">
        National figures for context — not specific to this agency&apos;s data
        above.
      </p>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Children in foster care nationally</div>
          <div className="stat-value">343,077</div>
          <div className="stat-note">FY2023 · down 39% since 1998 (559,000)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Children served nationally in FY2023</div>
          <div className="stat-value">527,180</div>
          <div className="stat-note">Total who passed through care during the year</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Parental rights terminated, FY2023</div>
          <div className="stat-value">48,459</div>
          <div className="stat-note">Children waiting on permanency nationally</div>
        </div>
      </div>
      <p className="meta">
        Source: U.S. Department of Health &amp; Human Services, Adoption and
        Foster Care Analysis and Reporting System (AFCARS), via{" "}
        <a
          href="https://usafacts.org/articles/how-many-kids-are-in-foster-care/"
          target="_blank"
          rel="noopener noreferrer"
        >
          USAFacts
        </a>
        . Figures are federal fiscal year 2023 — the most recent published at
        the time this page was built — and are static, not live-fetched.
      </p>
    </>
  );
}
