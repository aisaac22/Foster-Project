import Link from "next/link";

/**
 * Page-number pagination driven entirely by URL params. Server-rendered links,
 * no client state — a given page is bookmarkable. Preserves whatever other
 * params are active (filters, sort) by taking them in `params`.
 *
 * Shows: Prev  1 … 4 5 [6] 7 8 … 20  Next  with ellipses when there are many
 * pages, so the control stays compact.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
  params,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  params: Record<string, string>;
}) {
  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const qs = new URLSearchParams(params);
    if (p === 1) qs.delete("page");
    else qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  // Which page numbers to show: always 1 and last, a window around current,
  // ellipses for the gaps.
  const pages: (number | "…")[] = [];
  const window = 1; // pages on each side of current
  let last = 0;
  for (let p = 1; p <= totalPages; p++) {
    const inWindow = p === 1 || p === totalPages || Math.abs(p - page) <= window;
    if (inWindow) {
      if (last && p - last > 1) pages.push("…");
      pages.push(p);
      last = p;
    }
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      {page > 1 ? (
        <Link className="page-link" href={href(page - 1)}>← Prev</Link>
      ) : (
        <span className="page-link disabled">← Prev</span>
      )}

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="page-ellipsis">…</span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            className={`page-link ${p === page ? "current" : ""}`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link className="page-link" href={href(page + 1)}>Next →</Link>
      ) : (
        <span className="page-link disabled">Next →</span>
      )}
    </nav>
  );
}

/**
 * Parse a page param safely: positive integer, defaulting to 1.
 */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export const PAGE_SIZE = 25;
