import Link from "next/link";
import { query } from "@/lib/db";
import { Pagination, parsePage, PAGE_SIZE } from "@/components/Pagination";
import { UsefulLinks } from "@/components/UsefulLinks";
import { AdminCaseFilters } from "./AdminCaseFilters";
import { DeleteCaseButton } from "./DeleteCaseButton";

interface CaseRow {
  id: string;
  case_type: "recruitment" | "retention";
  status: "open" | "closed";
  owner_name: string | null;
  id_provider: string | null;
  county_name: string | null;
  n_notes: number;
  updated_at: string;
}

interface OwnerLoadRow {
  owner_name: string;
  open_count: number;
  total_count: number;
}

const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function target(c: CaseRow): string {
  return c.case_type === "retention" ? `Home #${c.id_provider}` : `${c.county_name} County`;
}

/**
 * All-cases admin view: every case, any owner, filterable and paginated,
 * with delete. Rendered both at /admin/cases (direct nav) and as the admin
 * home page inside /dashboard — the caller is responsible for the
 * requireAdmin() check before rendering this.
 */
export async function AdminCaseList({
  searchParams,
  basePath = "/admin/cases",
}: {
  searchParams: { case_type?: string; status?: string; owner?: string; page?: string };
  basePath?: string;
}) {
  const caseType =
    searchParams.case_type === "retention" || searchParams.case_type === "recruitment"
      ? searchParams.case_type
      : "all";
  const status = searchParams.status === "open" || searchParams.status === "closed" ? searchParams.status : "all";
  const owner = searchParams.owner?.trim() ?? "";
  const page = parsePage(searchParams.page);

  const owners = (
    await query<{ owner_name: string }>(
      `select distinct owner_name from cases where owner_name is not null order by owner_name`,
    )
  ).map((o) => o.owner_name);

  const [{ total }] = await query<{ total: string }>(
    `select count(*)::int as total
     from v_cases
     where ($1 = 'all' or case_type = $1)
       and ($2 = 'all' or status = $2)
       and ($3 = '' or owner_name = $3)`,
    [caseType, status, owner],
  );
  const totalRows = Number(total);
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const rows = await query<CaseRow>(
    `select id, case_type, status, owner_name, id_provider, county_name, n_notes, updated_at
     from v_cases
     where ($1 = 'all' or case_type = $1)
       and ($2 = 'all' or status = $2)
       and ($3 = '' or owner_name = $3)
     order by updated_at desc
     limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    [caseType, status, owner],
  );

  // Team workload — always unfiltered, so it stays a full roster even when
  // the case list above is scoped to one owner or status.
  const ownerLoad = await query<OwnerLoadRow>(
    `select owner_name,
            count(*) filter (where status = 'open')::int as open_count,
            count(*)::int as total_count
     from cases
     where owner_name is not null
     group by owner_name
     order by open_count desc, total_count desc`,
  );

  const pageParams: Record<string, string> = {};
  if (caseType !== "all") pageParams.case_type = caseType;
  if (status !== "all") pageParams.status = status;
  if (owner) pageParams.owner = owner;

  return (
    <>
      <h1>All cases</h1>
      <p className="subtitle">
        Every case across the team, recruitment and retention. 
        Delete removes a case and its notes permanently.
      </p>

      <AdminCaseFilters owners={owners} caseType={caseType} status={status} owner={owner} />

      {rows.length === 0 ? (
        <p className="empty">No cases match these filters.</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Target</th>
                <th>Status</th>
                <th>Owner</th>
                <th className="num">Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/cases/${c.id}`}>
                      {c.case_type === "retention" ? "Retention" : "Recruitment"}
                    </Link>
                  </td>
                  <td>{target(c)}</td>
                  <td>
                    <span
                      className="flag"
                      style={{ color: c.status === "open" ? "#15803d" : "#6b7280" }}
                    >
                      {c.status === "open" ? "Open" : "Closed"}
                    </span>
                  </td>
                  <td>{c.owner_name ?? "—"}</td>
                  <td className="num">{c.n_notes}</td>
                  <td>{fmtWhen(c.updated_at)}</td>
                  <td><DeleteCaseButton caseId={c.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination
            basePath={basePath}
            page={page}
            totalPages={totalPages}
            params={pageParams}
          />
        </>
      )}

      <p className="meta">
        {totalRows} case{totalRows === 1 ? "" : "s"} · page {page} of{" "}
        {Math.max(1, totalPages)}
      </p>

      <h2 style={{ fontSize: "1.1rem", margin: "2.5rem 0 0.75rem" }}>
        Caseload by user
      </h2>
      {ownerLoad.length === 0 ? (
        <p className="empty">No cases assigned yet.</p>
      ) : (
        <table className="data-table" style={{ maxWidth: 420 }}>
          <thead>
            <tr>
              <th>User</th>
              <th className="num">Open</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {ownerLoad.map((o) => (
              <tr key={o.owner_name}>
                <td>{o.owner_name}</td>
                <td className="num">{o.open_count}</td>
                <td className="num">{o.total_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <UsefulLinks />
    </>
  );
}
