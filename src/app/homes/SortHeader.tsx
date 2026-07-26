import Link from "next/link";

/**
 * A clickable table header that sorts by `col`. Clicking toggles asc/desc;
 * clicking a different column switches to it (desc first). All state lives in
 * the URL (?sort=col&dir=desc), so sorting is server-side and bookmarkable.
 */
export function SortHeader({
  label,
  col,
  currentSort,
  currentDir,
  params,
  numeric = false,
}: {
  label: string;
  col: string;
  currentSort: string;
  currentDir: string;
  params: Record<string, string>;
  numeric?: boolean;
}) {
  const isActive = currentSort === col;
  const nextDir = isActive && currentDir === "desc" ? "asc" : "desc";

  const qs = new URLSearchParams(params);
  qs.set("sort", col);
  qs.set("dir", nextDir);

  const arrow = isActive ? (currentDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <th className={numeric ? "num" : ""}>
      <Link href={`/homes?${qs.toString()}`} className="sort-link">
        {label}
        <span className="sort-arrow">{arrow}</span>
      </Link>
    </th>
  );
}
