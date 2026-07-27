import { requireUser } from "@/lib/require-user";
import { PAGES, GROUPS } from "@/lib/data-dictionary";

export default async function DataDictionaryPage() {
  await requireUser();

  return (
    <>
      <h1>Data dictionary</h1>
      <p className="subtitle">
        What each page in this app shows, and what every column on it means —
        a guide to the app itself, not the database behind it.
      </p>

      <nav className="dd-jump">
        {GROUPS.map((g) => (
          <a key={g.key} href={`#${g.key}`}>{g.label}</a>
        ))}
      </nav>

      {GROUPS.map((g) => {
        const pages = PAGES.filter((p) => p.group === g.key);
        if (pages.length === 0) return null;
        return (
          <section key={g.key} id={g.key} style={{ marginTop: "2.5rem" }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: "1.25rem" }}>{g.label}</h2>

            {pages.map((p) => (
              <div key={p.key} className="dd-table-card">
                <div className="dd-table-header">
                  <span className="dd-page-title">{p.title}</span>
                  <code className="dd-table-name">{p.path}</code>
                </div>
                <p className="dd-table-desc">{p.summary}</p>

                {p.sections.map((s, i) => (
                  <div key={i} style={{ marginTop: "1rem" }}>
                    {s.heading && (
                      <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem", color: "var(--ink)" }}>
                        {s.heading}
                      </h3>
                    )}
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: "220px" }}>Field</th>
                          <th>Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.fields.map((f) => (
                          <tr key={f.name}>
                            <td><code>{f.name}</code></td>
                            <td>{f.meaning}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
