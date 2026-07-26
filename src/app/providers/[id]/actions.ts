"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";

/**
 * Log a retention contact against a home. Called directly from the form on the
 * provider page — a Server Action, so no API route, no client fetch. Next.js
 * handles the round trip.
 *
 * Records the Clerk user id and display name so the log has an audit trail.
 */
export async function logContact(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const user = await currentUser();
  const displayName =
    user?.username ??
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ??
    "Unknown";

  const idProvider = Number(formData.get("id_provider"));
  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const followUpRaw = String(formData.get("follow_up_on") ?? "").trim();
  const followUp = followUpRaw || null;

  const allowed = ["reached", "no_answer", "re_engaged", "plans_to_close", "other"];
  if (!Number.isFinite(idProvider) || !allowed.includes(outcome)) {
    throw new Error("Invalid contact submission");
  }

  await pool.query(
    `insert into provider_contacts
       (id_provider, logged_by, logged_by_name, outcome, note, follow_up_on)
     values ($1, $2, $3, $4, $5, $6)`,
    [idProvider, userId, displayName, outcome, note, followUp],
  );

  // Refresh the provider page and the at-risk list so the new contact shows.
  revalidatePath(`/providers/${idProvider}`);
  revalidatePath("/at-risk");
}
