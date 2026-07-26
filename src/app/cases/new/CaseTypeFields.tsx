"use client";

import { useState } from "react";

/**
 * Swaps the target field based on case type: a home # for retention, a
 * county dropdown for recruitment. Unmounting the inactive field (rather
 * than just hiding it) keeps its value out of the submitted FormData, so
 * the server action only ever sees the field that matches the type.
 */
export function CaseTypeFields({
  counties,
}: {
  counties: { id: number; name: string }[];
}) {
  const [caseType, setCaseType] = useState<"retention" | "recruitment">(
    "retention",
  );

  return (
    <>
      <label className="filter-field">
        Case type
        <select
          name="case_type"
          value={caseType}
          onChange={(e) => setCaseType(e.target.value as typeof caseType)}
        >
          <option value="retention">Retention</option>
          <option value="recruitment">Recruitment</option>
        </select>
      </label>

      {caseType === "retention" ? (
        <label className="filter-field">
          Home #
          <input
            type="text"
            inputMode="numeric"
            name="id_provider"
            placeholder="e.g. 505727"
            required
          />
        </label>
      ) : (
        <label className="filter-field">
          County
          <select name="county_id" required defaultValue="">
            <option value="" disabled>Select a county…</option>
            {counties.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
