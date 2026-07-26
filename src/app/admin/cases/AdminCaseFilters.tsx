"use client";

import { useRouter } from "next/navigation";

/**
 * Filters for the admin case list: type, status, owner. Same URL-param
 * pattern as HomesFilters — pushes to the URL and lets the server component
 * re-query, so the view stays bookmarkable.
 */
export function AdminCaseFilters({
  owners,
  caseType,
  status,
  owner,
}: {
  owners: string[];
  caseType: string;
  status: string;
  owner: string;
}) {
  const router = useRouter();

  function navigate(next: { case_type?: string; status?: string; owner?: string }) {
    const params = new URLSearchParams();
    const ct = next.case_type ?? caseType;
    const st = next.status ?? status;
    const ow = next.owner ?? owner;
    if (ct && ct !== "all") params.set("case_type", ct);
    if (st && st !== "all") params.set("status", st);
    if (ow) params.set("owner", ow);
    const qs = params.toString();
    router.push(qs ? `/admin/cases?${qs}` : "/admin/cases");
  }

  return (
    <div className="filters">
      <label className="filter-field">
        Type
        <select value={caseType} onChange={(e) => navigate({ case_type: e.target.value })}>
          <option value="all">All</option>
          <option value="retention">Retention</option>
          <option value="recruitment">Recruitment</option>
        </select>
      </label>

      <label className="filter-field">
        Status
        <select value={status} onChange={(e) => navigate({ status: e.target.value })}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      <label className="filter-field">
        Owner
        <select value={owner} onChange={(e) => navigate({ owner: e.target.value })}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
