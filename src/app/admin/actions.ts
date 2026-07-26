"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { requireAdmin } from "@/lib/require-user";

/**
 * Hard-delete a case (and its notes, via ON DELETE CASCADE). Admin-only —
 * checked here, not just by hiding the button, same pattern as the rest of
 * the case actions.
 */
export async function deleteCase(formData: FormData) {
  await requireAdmin();

  const caseId = Number(formData.get("case_id"));
  if (!Number.isFinite(caseId)) throw new Error("Invalid case id");

  await pool.query(`delete from cases where id = $1`, [caseId]);

  revalidatePath("/admin/cases");
  revalidatePath("/dashboard");
}
