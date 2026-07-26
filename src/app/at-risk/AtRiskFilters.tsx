"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Filter controls for the at-risk list. Client component (needs interactivity),
 * but it holds no data — it just pushes URL search params and lets the server
 * component re-query. County filter reloads with ?county=X; the ID box navigates
 * straight to a home's detail page.
 */
export function AtRiskFilters({
  counties,
  selectedCounty,
}: {
  counties: string[];
  selectedCounty: string;
}) {
  const router = useRouter();
  const [homeId, setHomeId] = useState("");

  function onCountyChange(value: string) {
    router.push(value ? `/at-risk?county=${encodeURIComponent(value)}` : "/at-risk");
  }

  function jumpToHome(e: React.FormEvent) {
    e.preventDefault();
    const id = homeId.trim();
    if (id) router.push(`/providers/${encodeURIComponent(id)}`);
  }

  return (
    <div className="filters">
      <label className="filter-field">
        County
        <select
          value={selectedCounty}
          onChange={(e) => onCountyChange(e.target.value)}
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
