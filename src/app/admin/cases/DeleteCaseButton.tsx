"use client";

import { deleteCase } from "../actions";

/** Wraps the delete form with a confirm dialog — deleting a case is
 * permanent (cascades to its notes), unlike closing one. */
export function DeleteCaseButton({ caseId }: { caseId: string }) {
  return (
    <form
      action={deleteCase}
      onSubmit={(e) => {
        if (!confirm(`Delete case #${caseId}? This also deletes its notes and cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="case_id" value={caseId} />
      <button type="submit" className="btn btn-secondary" style={{ color: "#b91c1c" }}>
        Delete
      </button>
    </form>
  );
}
