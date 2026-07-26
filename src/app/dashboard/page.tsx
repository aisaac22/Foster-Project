import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser, isAdmin } from "@/lib/require-user";
import { AdminCaseList } from "../admin/cases/AdminCaseList";

export const dynamic = "force-dynamic";

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

const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function target(c: CaseRow): string {
  return c.case_type === "retention" ? `Home #${c.id_provider}` : `${c.county_name} County`;
}

function CaseTable({ rows, showOwner }: { rows: CaseRow[]; showOwner?: boolean }) {
  return (
    <table className="data-table" style={{ marginBottom: "2rem" }}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Target</th>
          <th>Status</th>
          {showOwner && <th>Owner</th>}
          <th className="num">Notes</th>
          <th>Updated</th>
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
            {showOwner && <td>{c.owner_name ?? "—"}</td>}
            <td className="num">{c.n_notes}</td>
            <td>{fmtWhen(c.updated_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ case_type?: string; status?: string; owner?: string; page?: string }>;
}) {
  const userId = await requireUser();

  if (await isAdmin()) {
    const sp = await searchParams;
    return <AdminCaseList searchParams={sp} basePath="/dashboard" />;
  }

  const myCases = await query<CaseRow>(
    `select id, case_type, status, owner_name, id_provider, county_name, n_notes, updated_at
     from v_cases
     where owner_id = $1
     order by (status = 'open') desc, updated_at desc`,
    [userId],
  );

  const otherOpenCases = await query<CaseRow>(
    `select id, case_type, status, owner_name, id_provider, county_name, n_notes, updated_at
     from v_cases
     where owner_id <> $1 and status = 'open'
     order by updated_at desc
     limit 50`,
    [userId],
  );

  return (
    <>
      <h1>Dashboard</h1>
      <p className="subtitle">
        Your cases, plus open work from the rest of the team.
      </p>

      <p style={{ marginBottom: "1.5rem" }}>
        <Link href="/cases/new" className="btn">+ New case</Link>
      </p>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Your cases</h2>
      {myCases.length === 0 ? (
        <p className="empty">You have no cases yet. Create one to get started.</p>
      ) : (
        <CaseTable rows={myCases} />
      )}

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        Other open cases
      </h2>
      {otherOpenCases.length === 0 ? (
        <p className="empty">No other open cases.</p>
      ) : (
        <CaseTable rows={otherOpenCases} showOwner />
      )}
    </>
  );
}
