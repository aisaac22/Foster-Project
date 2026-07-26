"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Controls for the all-homes browse page: status filter, county filter, and a
 * home-ID jump. Like the at-risk filters, everything is pushed to URL params so
 * the view is bookmarkable and the server does the querying. Sort is handled by
 * clickable column headers in the page itself, not here.
 */
export function HomesFilters({
  counties,
  selectedCounty,
  status,
}: {
  counties: string[];
  selectedCounty: string;
  status: string;
}) {
  const router = useRouter();
  const [homeId, setHomeId] = useState("");

  // Rebuild the query string preserving whatever isn't being changed.
  function navigate(next: { county?: string; status?: string }) {
    const params = new URLSearchParams();
    const county = next.county ?? selectedCounty;
    const st = next.status ?? status;
    if (county) params.set("county", county);
    if (st && st !== "all") params.set("status", st);
    const qs = params.toString();
    router.push(qs ? `/homes?${qs}` : "/homes");
  }

  function jumpToHome(e: React.FormEvent) {
    e.preventDefault();
    const id = homeId.trim();
    if (id) router.push(`/providers/${encodeURIComponent(id)}`);
  }

  return (
    <div className="filters">
      <label className="filter-field">
        Status
        <select value={status} onChange={(e) => navigate({ status: e.target.value })}>
          <option value="all">All</option>
          <option value="active">Active (licensed)</option>
          <option value="exited">Exited</option>
        </select>
      </label>

      <label className="filter-field">
        County
        <select
          value={selectedCounty}
          onChange={(e) => navigate({ county: e.target.value })}
        >
          <option value="">All counties</option>
          {counties.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <form onSubmit={jumpToHome} className="filter-field">
        Go to home #
        <span className="jump-row">
          <input
            type="text"
            inputMode="numeric"
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
            placeholder="e.g. 505727"
          />
          <button type="submit">Go</button>
        </span>
      </form>
    </div>
  );
}
