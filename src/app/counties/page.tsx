import { query } from "@/lib/db";
import { num, pct, oneDp } from "@/lib/format";
import { requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

interface Row {
  county: string;
  children_from_county: number;
  children_in_local_homes: number;
  homes_licensed: number;
  load_per_home: number | null;
  export_rate: number | null;
  kin_rate: number | null;
  net_outflow: number;
}

export default async function CountiesPage() {
  await requireUser();
  const rows = await query<Row>(`
    select county, children_from_county, children_in_local_homes,
           homes_licensed, load_per_home, export_rate, kin_rate, net_outflow
    from v_county_supply_demand
    where homes_licensed > 0 or children_from_county > 0
    order by net_outflow desc
  `);

  return (
    <>
      <h1>County supply &amp; demand</h1>
      <p className="subtitle">
        Net outflow is the number of a county&apos;s children it cannot house in
        its own foster homes — the clearest recruitment target. Load per home
        counts children actually placed within the county, so it stays around 2
        even where many children are exported elsewhere.
      </p>

      {rows.length === 0 ? (
        <p className="empty">No county data yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>County</th>
              <th className="num">Net outflow</th>
              <th className="num">From county</th>
              <th className="num">In local homes</th>
              <th className="num">Licensed homes</th>
              <th className="num">Load / home</th>
              <th className="num">Exported</th>
              <th className="num">Kin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.county}>
                <td>{r.county}</td>
                <td className="num" style={{ fontWeight: 650 }}>
                  {num(r.net_outflow)}
                </td>
                <td className="num">{num(r.children_from_county)}</td>
                <td className="num">{num(r.children_in_local_homes)}</td>
                <td className="num">{num(r.homes_licensed)}</td>
                <td className="num">{oneDp(r.load_per_home)}</td>
                <td className="num">{pct(r.export_rate)}</td>
                <td className="num">{pct(r.kin_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="meta">{rows.length} counties with homes or children in care.</p>
    </>
  );
}
