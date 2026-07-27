import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { pct, oneDp, num } from "@/lib/format";
import { HomesFilters } from "./HomesFilters";
import { SortHeader } from "./SortHeader";
import { Pagination, parsePage, PAGE_SIZE } from "@/components/Pagination";

export const dynamic = "force-dynamic";

interface Row {
  id_provider: string;
  county: string | null;
  is_currently_licensed: boolean;
  tenure_years: number;
  utilization_rate: number | null;
  n_placements: number;
  n_children_served: number;
  days_idle: number;
  has_child_now: boolean;
  license_end_date: string | null;
}

// Whitelist: URL sort param -> SQL expression. Prevents injection; the param
// can only ever be one of these six keys.
const SORT_COLUMNS: Record<string, string> = {
  county: "h.county",
  tenure: "h.days_licensed_calc",
  utilization: "h.utilization_rate",
  placements: "h.n_placements",
  children: "h.n_children_served",
  idle: "h.days_idle",
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

export default async function HomesPage({
  searchParams,
}: {
  searchParams: Promise<{
    county?: string;
    status?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  await requireUser();
  const sp = await searchParams;

  const selectedCounty = sp.county?.trim() ?? "";
  const status = sp.status === "active" || sp.status === "exited" ? sp.status : "all";
  const sort = sp.sort && SORT_COLUMNS[sp.sort] ? sp.sort : "utilization";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const page = parsePage(sp.page);

  const counties = (
    await query<{ county: string }>(`
      select distinct county from v_provider_service_history
      where county is not null order by county
    `)
  ).map((c) => c.county);

  const statusClause =
    status === "active"
      ? "and h.is_currently_licensed"
      : status === "exited"
      ? "and not h.is_currently_licensed"
      : "";

  // Total for pagination.
  const [{ total }] = await query<{ total: string }>(
    `select count(*)::int as total
     from v_provider_service_history h
     where ($1 = '' or h.county = $1) ${statusClause}`,
    [selectedCounty],
  );
  const totalRows = Number(total);
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const orderExpr = SORT_COLUMNS[sort];

  const rows = await query<Row>(
    `
    select h.id_provider, h.county, h.is_currently_licensed,
           round(h.days_licensed_calc / 365.0, 1) as tenure_years,
           h.utilization_rate, h.n_placements, h.n_children_served,
           h.days_idle, h.has_child_now, h.license_end_date
    from v_provider_service_history h
    where ($1 = '' or h.county = $1)
      ${statusClause}
    order by ${orderExpr} ${dir} nulls last
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
  `,
    [selectedCounty],
  );

  // Params preserved on sort-header links: county + status (NOT page — re-sort
  // resets to page 1, which is the correct behavior).
  const linkParams: Record<string, string> = {};
  if (selectedCounty) linkParams.county = selectedCounty;
  if (status !== "all") linkParams.status = status;

  // Params preserved on pagination links: everything, INCLUDING sort/dir, so
  // paging keeps your current ordering.
  const pageParams: Record<string, string> = { ...linkParams };
  if (sort !== "utilization") pageParams.sort = sort;
  if (dir !== "desc") pageParams.dir = dir;

  return (
    <>
      <h1>All homes</h1>
      <p className="subtitle">
        Every foster home, currently licensed and exited. Sort by any column to
        browse: your longest-tenured homes, least-used active homes, or the
        exited homes worth learning from. For the daily retention worklist, see{" "}
        <Link href="/at-risk">at-risk homes</Link>.
      </p>

      <HomesFilters
        counties={counties}
        selectedCounty={selectedCounty}
        status={status}
      />

      {rows.length === 0 ? (
        <p className="empty">No homes match these filters.</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Home</th>
                <SortHeader label="County" col="county" currentSort={sort} currentDir={dir} params={linkParams} />
                <th>Status</th>
                <SortHeader label="Tenure" col="tenure" currentSort={sort} currentDir={dir} params={linkParams} numeric />
                <SortHeader label="Utilization" col="utilization" currentSort={sort} currentDir={dir} params={linkParams} numeric />
                <SortHeader label="Placements" col="placements" currentSort={sort} currentDir={dir} params={linkParams} numeric />
                <SortHeader label="Children" col="children" currentSort={sort} currentDir={dir} params={linkParams} numeric />
                <SortHeader label="Idle days" col="idle" currentSort={sort} currentDir={dir} params={linkParams} numeric />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id_provider}>
                  <td>
                    <Link href={`/providers/${r.id_provider}`}>#{r.id_provider}</Link>
                  </td>
                  <td>{r.county ?? "—"}</td>
                  <td>
                    {r.is_currently_licensed ? (
                      r.has_child_now ? (
                        <span className="flag" style={{ color: "#15803d", borderColor: "#bbf7d0" }}>
                          Active · placed
                        </span>
                      ) : (
                        <span className="flag">Active</span>
                      )
                    ) : (
                      <span className="contacted-tag">
                        Exited {r.license_end_date ? fmtDate(r.license_end_date) : ""}
                      </span>
                    )}
                  </td>
                  <td className="num">{oneDp(r.tenure_years)}y</td>
                  <td className="num">{pct(r.utilization_rate)}</td>
                  <td className="num">{num(r.n_placements)}</td>
                  <td className="num">{num(r.n_children_served)}</td>
                  <td className="num">{r.has_child_now ? "—" : num(r.days_idle)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination
            basePath="/homes"
            page={page}
            totalPages={totalPages}
            params={pageParams}
          />
        </>
      )}

      <p className="meta">
        {totalRows} homes
        {selectedCounty ? ` in ${selectedCounty}` : ""}
        {status !== "all" ? ` · ${status}` : ""} · page {page} of{" "}
        {Math.max(1, totalPages)}
      </p>
    </>
  );
}
