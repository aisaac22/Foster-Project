import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { addCaseNote, toggleCaseStatus } from "../actions";

export const dynamic = "force-dynamic";

interface CaseRow {
  id: string;
  case_type: "recruitment" | "retention";
  status: "open" | "closed";
  owner_id: string;
  owner_name: string | null;
  id_provider: string | null;
  county_id: number | null;
  county_name: string | null;
  created_at: string;
  closed_at: string | null;
}

interface Note {
  id: string;
  author_name: string | null;
  note: string;
  created_at: string;
}

const fmtWhen = (d: string) =>
  new Date(d).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUser();
  const { id } = await params;

  const [caseRow] = await query<CaseRow>(
    `select id, case_type, status, owner_id, owner_name, id_provider,
            county_id, county_name, created_at, closed_at
     from v_cases
     where id = $1`,
    [id],
  );
  if (!caseRow) notFound();

  const notes = await query<Note>(
    `select id, author_name, note, created_at
     from case_notes
     where case_id = $1
     order by created_at desc`,
    [id],
  );

  const isOwner = caseRow.owner_id === userId;
  const isOpen = caseRow.status === "open";

  return (
    <>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <h1>
        {caseRow.case_type === "retention" ? "Retention" : "Recruitment"} case
        #{caseRow.id}
      </h1>
      <p className="subtitle">
        {caseRow.case_type === "retention" ? (
          <>
            Home{" "}
            <Link href={`/providers/${caseRow.id_provider}`}>
              #{caseRow.id_provider}
            </Link>
            {caseRow.county_name ? ` · ${caseRow.county_name}` : ""}
          </>
        ) : (
          <>County: {caseRow.county_name ?? "—"}</>
        )}
        {" · Opened by "}
        {caseRow.owner_name ?? "Unknown"}
        {" on "}
        {fmtWhen(caseRow.created_at)}
      </p>

      <div style={{ marginBottom: "1.5rem" }}>
        <span className="flag" style={{ color: isOpen ? "#15803d" : "#6b7280" }}>
          {isOpen ? "Open" : "Closed"}
        </span>
        {isOwner && (
          <form
            action={toggleCaseStatus}
            style={{ display: "inline-block", marginLeft: "0.75rem" }}
          >
            <input type="hidden" name="case_id" value={caseRow.id} />
            <input type="hidden" name="next_status" value={isOpen ? "closed" : "open"} />
            <button type="submit" className="btn btn-secondary">
              {isOpen ? "Close case" : "Reopen case"}
            </button>
          </form>
        )}
      </div>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Notes</h2>

      <form action={addCaseNote} className="contact-form" style={{ maxWidth: 520 }}>
        <input type="hidden" name="case_id" value={caseRow.id} />
        <label>
          Note
          <textarea name="note" rows={3} required placeholder="What happened…" />
        </label>
        <button type="submit">Add note</button>
      </form>

      {notes.length === 0 ? (
        <p className="empty" style={{ paddingTop: "1rem" }}>No notes yet.</p>
      ) : (
        <table className="data-table" style={{ marginTop: "1.25rem" }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(n.created_at)}</td>
                <td>{n.author_name ?? "—"}</td>
                <td>{n.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
