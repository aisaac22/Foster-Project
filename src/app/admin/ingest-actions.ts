"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-user";
import { ingest } from "@/lib/ingest";

export interface IngestActionResult {
  ok: boolean;
  message: string;
}

/** formData.get() on an empty <input type="file"> still returns a File with
 * size 0, not null — treat that as "not provided," matching the CLI's
 * optional children/providers/placements. */
async function fileText(formData: FormData, name: string): Promise<string | undefined> {
  const file = formData.get(name);
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file.text();
}

/**
 * Runs the same ingest pipeline as scripts/ingest.ts, triggered from the
 * admin upload modal instead of the CLI. Admin-only — checked here, not
 * just by hiding the button.
 */
export async function uploadCsvIngest(formData: FormData): Promise<IngestActionResult> {
  await requireAdmin();

  const snapshotDate = String(formData.get("snapshot_date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    return { ok: false, message: "Enter a valid snapshot date." };
  }

  const [children, providers, placements] = await Promise.all([
    fileText(formData, "children"),
    fileText(formData, "providers"),
    fileText(formData, "placements"),
  ]);

  if (!children && !providers && !placements) {
    return { ok: false, message: "Select at least one CSV file to upload." };
  }

  try {
    const result = await ingest({
      snapshotDate,
      children,
      providers,
      placements,
      source: "admin-upload",
    });

    revalidatePath("/", "layout");

    const loaded = Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ");
    const discrepancyNote =
      result.discrepancyCount > 0
        ? ` ${result.discrepancyCount} placement-length discrepancies logged.`
        : "";
    return { ok: true, message: `Loaded ${loaded || "0 rows"}.${discrepancyNote}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
