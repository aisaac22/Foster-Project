"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, query } from "@/lib/db";

async function ownerName(): Promise<string> {
  const user = await currentUser();
  return (
    user?.username ??
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ??
    "Unknown"
  );
}

/**
 * Create a case. Type determines which target field is required — a
 * retention case is tied to a home, a recruitment case to a county — the
 * database's check constraint enforces this too, so a bypassed form can't
 * create a malformed case.
 */
export async function createCase(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const caseType = String(formData.get("case_type") ?? "");
  if (caseType !== "recruitment" && caseType !== "retention") {
    throw new Error("Invalid case type");
  }

  const note = String(formData.get("note") ?? "").trim() || null;
  const displayName = await ownerName();

  let idProvider: number | null = null;
  let countyId: number | null = null;

  if (caseType === "retention") {
    idProvider = Number(formData.get("id_provider"));
    if (!Number.isFinite(idProvider)) throw new Error("Select a home");
    const [home] = await query<{ id_provider: string }>(
      `select id_provider from providers where id_provider = $1`,
      [idProvider],
    );
    if (!home) throw new Error("Home not found");
  } else {
    countyId = Number(formData.get("county_id"));
    if (!Number.isFinite(countyId)) throw new Error("Select a county");
    const [county] = await query<{ id: number }>(
      `select id from counties where id = $1`,
      [countyId],
    );
    if (!county) throw new Error("County not found");
  }

  const [row] = await query<{ id: string }>(
    `insert into cases (case_type, id_provider, county_id, owner_id, owner_name)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [caseType, idProvider, countyId, userId, displayName],
  );

  if (note) {
    await pool.query(
      `insert into case_notes (case_id, author_id, author_name, note)
       values ($1, $2, $3, $4)`,
      [row.id, userId, displayName, note],
    );
  }

  revalidatePath("/dashboard");
  redirect(`/cases/${row.id}`);
}

/** Add a note to a case. Any signed-in user can add a note — notes are a
 * shared work log, not owner-only. */
export async function addCaseNote(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const caseId = Number(formData.get("case_id"));
  const note = String(formData.get("note") ?? "").trim();
  if (!Number.isFinite(caseId) || !note) throw new Error("Invalid note submission");

  const displayName = await ownerName();

  await pool.query(
    `insert into case_notes (case_id, author_id, author_name, note)
     values ($1, $2, $3, $4)`,
    [caseId, userId, displayName, note],
  );

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/dashboard");
}

/**
 * Toggle a case between open and closed. Owner-only: the button is hidden
 * for non-owners, but the WHERE clause enforces it server-side too — a
 * crafted request still can't close someone else's case.
 */
export async function toggleCaseStatus(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const caseId = Number(formData.get("case_id"));
  const nextStatus = String(formData.get("next_status") ?? "");
  if (!Number.isFinite(caseId) || (nextStatus !== "open" && nextStatus !== "closed")) {
    throw new Error("Invalid status update");
  }

  const result = await pool.query(
    `update cases
     set status = $1, closed_at = case when $1 = 'closed' then now() else null end
     where id = $2 and owner_id = $3`,
    [nextStatus, caseId, userId],
  );
  if (result.rowCount === 0) throw new Error("Not authorized to update this case");

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/dashboard");
}
