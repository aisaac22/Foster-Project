/**
 * Page-by-page documentation: what each screen in the app is for, and what
 * every column/field on it actually means. This describes the UI, not the
 * database — for the underlying tables, read the SQL in db/*.sql directly.
 */

export interface FieldDoc {
  name: string;
  meaning: string;
}

export interface PageSection {
  heading?: string;
  fields: FieldDoc[];
}

export interface PageDoc {
  key: string;
  path: string;
  title: string;
  group: string;
  summary: string;
  sections: PageSection[];
}

export const GROUPS = [
  { key: "retention", label: "Retention" },
  { key: "recruitment", label: "Recruitment & counties" },
  { key: "trend", label: "Trend" },
];

export const PAGES: PageDoc[] = [
  // ---------------------------------------------------------------- retention
  {
    key: "at-risk",
    path: "/at-risk",
    title: "At-risk homes",
    group: "retention",
    summary:
      "Currently licensed foster homes ranked by likelihood of disengaging or not renewing — the daily retention worklist. Homes near the top are still licensed and reachable; a contact now is cheaper than recruiting a replacement.",
    sections: [
      {
        fields: [
          { name: "Home", meaning: "Links to the home's detail page." },
          { name: "County", meaning: "County the home is licensed in." },
          { name: "Tenure", meaning: "Years since the home was licensed." },
          { name: "Placements", meaning: "Total placements the home has ever had." },
          { name: "Utilization", meaning: "Share of licensed days the home actually had a child placed." },
          { name: "Why flagged", meaning: "The specific reasons driving the risk score: Never placed, Low engagement, New home, or Idle 6mo+." },
          { name: "Last contact", meaning: "Date and outcome of the most recent retention contact logged on this home. Highlighted green if within the last 14 days." },
          { name: "Risk", meaning: "0–100 composite score (bar + number) — low utilization, never being used, idle time, and short tenure all push it up. Sort order for the whole page." },
        ],
      },
    ],
  },
  {
    key: "homes",
    path: "/homes",
    title: "All homes",
    group: "retention",
    summary: "Every foster home, licensed and exited. Sortable by any column — for browsing rather than working a queue.",
    sections: [
      {
        fields: [
          { name: "Home", meaning: "Links to the home's detail page." },
          { name: "County", meaning: "Sortable." },
          { name: "Status", meaning: "Active, Active · placed (has a child right now), or Exited with the license-end date." },
          { name: "Tenure", meaning: "Sortable. Years since licensed." },
          { name: "Utilization", meaning: "Sortable. Share of licensed days with a child placed." },
          { name: "Placements", meaning: "Sortable. Total placements ever." },
          { name: "Children", meaning: "Sortable. Distinct children served." },
          { name: "Idle days", meaning: "Sortable. Days since the last placement ended — shows \"—\" if a child is placed right now." },
        ],
      },
    ],
  },
  {
    key: "provider-detail",
    path: "/providers/[id]",
    title: "Home detail",
    group: "retention",
    summary: "One home's full service history, placement timeline, and retention contact log. Reached by clicking any home elsewhere in the app.",
    sections: [
      {
        heading: "Summary stats",
        fields: [
          { name: "Utilization (days active)", meaning: "Share of licensed days with a child actually placed." },
          { name: "Children served", meaning: "Distinct children this home has taken." },
          { name: "Total placements", meaning: "All placements ever, including repeats." },
          { name: "Days to first placement", meaning: "How long after licensing the home took its first child." },
          { name: "Days idle", meaning: "Days since the last placement ended." },
        ],
      },
      {
        heading: "Placement history",
        fields: [
          { name: "#", meaning: "This placement's order in the home's own history." },
          { name: "Start / End", meaning: "Placement dates." },
          { name: "Days", meaning: "Length of the placement." },
          { name: "County", meaning: "Where the placement is located." },
          { name: "Status", meaning: "\"Current\" if the placement is still ongoing." },
        ],
      },
      {
        heading: "Retention contacts",
        fields: [
          { name: "Outcome", meaning: "How the contact went: Reached, No answer, Re-engaged, Plans to close, or Other." },
          { name: "Follow up on", meaning: "An optional date to come back to this home." },
          { name: "Note", meaning: "Free-text notes about what was discussed." },
          { name: "History table", meaning: "Every past contact for this home — Date, Outcome, By (who logged it), Note, Follow up." },
        ],
      },
    ],
  },

  // -------------------------------------------------------- recruitment
  {
    key: "counties",
    path: "/counties",
    title: "Counties",
    group: "recruitment",
    summary: "Supply and demand by county, led by net outflow, the clearest recruitment target.",
    sections: [
      {
        fields: [
          { name: "County", meaning: "County name." },
          { name: "Net outflow", meaning: "Children the county can't house in its own foster homes. Sort order for the whole page." },
          { name: "From county", meaning: "Children currently removed from this county with an open placement." },
          { name: "In local homes", meaning: "Of those, how many are placed in a foster home within the same county." },
          { name: "Licensed homes", meaning: "Currently licensed homes in the county." },
          { name: "Load / home", meaning: "Children placed locally, per licensed home — stays near a stable number even where many children are exported elsewhere." },
          { name: "Exported", meaning: "Share of the county's children placed outside the county." },
          { name: "Kin", meaning: "Share of the county's children placed with kin rather than a licensed home." },
        ],
      },
    ],
  },
  {
    key: "recruitment",
    path: "/recruitment",
    title: "Recruitment — age & capacity gaps",
    group: "recruitment",
    summary:
      "A county × age-band matrix: children in care vs. homes willing to take that age. Red cells are recruitment targets. Counties are ordered by total unmet need; age preferences reflect each home's current stated range, so this is forward-looking, not a record of past matching.",
    sections: [
      {
        fields: [
          { name: "Cell value", meaning: "Children per accepting home for that county + age band. Color-coded green (≤1, fine) through red (4+, severe)." },
          { name: "\"N:0\"", meaning: "N children in that band, and zero homes currently accepting it." },
          { name: "Hover tooltip", meaning: "Exact counts: children in the band, homes that accept this age, and homes open right now." },
          { name: "Total gap column", meaning: "Sum of unmet need across every age band for that county." },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- trend
  {
    key: "trend",
    path: "/trend",
    title: "Monthly trend",
    group: "trend",
    summary: "Licensed homes gained, lost, and active at month end, across all counties. This is the clearest read on whether recruitment is keeping pace with retention losses over time.",
    sections: [
      {
        heading: "Chart & monthly detail",
        fields: [
          { name: "New licenses", meaning: "Homes newly licensed that month." },
          { name: "Exits", meaning: "Homes whose license ended that month." },
          { name: "Active (month end)", meaning: "Homes actively licensed as of the end of that month." },
        ],
      },
      {
        heading: "Federal context",
        fields: [
          { name: "Children in foster care nationally", meaning: "National AFCARS figure, for scale — not this agency's own count." },
          { name: "Children served nationally", meaning: "Total who passed through the national foster care system during the federal fiscal year." },
          { name: "Parental rights terminated", meaning: "National count of children waiting on permanency. Static figures with a source citation, not live-fetched." },
        ],
      },
    ],
  },
];
