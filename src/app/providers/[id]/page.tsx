import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { pct, oneDp, num } from "@/lib/format";
import { requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

interface Provider {
  id_provider: string;
  county: string | null;
  license_start_date: string | null;
  license_end_date: string | null;
  is_currently_licensed: boolean;
  utilization_rate: number | null;
  n_placements: number;
  n_children_served: number;
  n_short_stays: number;
  days_to_first_placement: number | null;
  days_idle: number;
  current_min_age: number | null;
  current_max_age: number | null;
}

interface Placement {
  placement_index: number;
  start_date: string;
  end_date: string | null;
  days_in_placement: number;
  is_ongoing: boolean;
  is_short_stay: boolean;
  placement_county: string | null;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const [provider] = await query<Provider>(
    `select id_provider, county, license_start_date, license_end_date,
            is_currently_licensed, utilization_rate, n_placements,
            n_children_served, n_short_stays, days_to_first_placement,
            days_idle, current_min_age, current_max_age
     from v_provider_service_history
     where id_provider = $1`,
    [id],
  );

  if (!provider) notFound();

  const placements = await query<Placement>(
    `select placement_index, start_date, end_date, days_in_placement,
            is_ongoing, is_short_stay, placement_county
     from v_placements_enriched
     where id_provider = $1
     order by start_date`,
    [id],
  );

  return (
    <>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/at-risk">← Back to at-risk homes</Link>
      </p>

      <h1>Home #{provider.id_provider}</h1>
      <p className="subtitle">
        {provider.county ?? "Unknown county"} ·{" "}
        {provider.is_currently_licensed ? "Currently licensed" : "License ended"} ·
        Licensed {fmtDate(provider.license_start_date)}
        {provider.license_end_date ? ` – ${fmtDate(provider.license_end_date)}` : ""}
        {provider.current_min_age !== null && (
          <> · Accepts ages {provider.current_min_age}–{provider.current_max_age}</>
        )}
      </p>

      <table className="data-table" style={{ maxWidth: 520, marginBottom: "2.5rem" }}>
        <tbody>
          <tr><td>Utilization</td><td className="num">{pct(provider.utilization_rate)}</td></tr>
          <tr><td>Children served</td><td className="num">{num(provider.n_children_served)}</td></tr>
          <tr><td>Total placements</td><td className="num">{num(provider.n_placements)}</td></tr>
          <tr><td>Short stays (&lt;30d)</td><td className="num">{num(provider.n_short_stays)}</td></tr>
          <tr>
            <td>Disruption rate</td>
            <td className="num">
              {provider.n_placements > 0
                ? pct(provider.n_short_stays / provider.n_placements)
                : "—"}
            </td>
          </tr>
          <tr>
            <td>Days to first placement</td>
            <td className="num">{provider.days_to_first_placement ?? "—"}</td>
          </tr>
          <tr><td>Days idle</td><td className="num">{num(provider.days_idle)}</td></tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        Placement history
      </h2>
      {placements.length === 0 ? (
        <p className="empty">This home has never had a placement.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Start</th>
              <th>End</th>
              <th className="num">Days</th>
              <th>County</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <tr key={p.placement_index}>
                <td className="num">{p.placement_index}</td>
                <td>{fmtDate(p.start_date)}</td>
                <td>{p.is_ongoing ? "ongoing" : fmtDate(p.end_date)}</td>
                <td className="num">{num(p.days_in_placement)}</td>
                <td>{p.placement_county ?? "—"}</td>
                <td>
                  {p.is_short_stay && <span className="flag">Short stay</span>}
                  {p.is_ongoing && <span className="flag">Current</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
