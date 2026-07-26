import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { createCase } from "../actions";
import { CaseTypeFields } from "./CaseTypeFields";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  await requireUser();

  const counties = await query<{ id: number; name: string }>(
    `select id, name from counties order by name`,
  );

  return (
    <>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <h1>New case</h1>
      <p className="subtitle">
        Retention cases track outreach to a specific home. Recruitment cases
        track sourcing new homes for a county.
      </p>

      <form action={createCase} className="contact-form" style={{ maxWidth: 480 }}>
        <CaseTypeFields counties={counties} />
        <label>
          Note (optional)
          <textarea name="note" rows={3} placeholder="Starting point, context…" />
        </label>
        <button type="submit">Create case</button>
      </form>
    </>
  );
}
