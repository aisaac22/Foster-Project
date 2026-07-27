const LINKS = [
  {
    title: "Become a Foster or Adoptive Parent",
    href: "https://dcfs.illinois.gov/loving-homes/become-a-foster-or-adoptive-parent.html",
    desc: "The DCFS intake form that routes a prospective family's information to the recruitment team in their area — the single most useful link for a recruiter: it's the thing you send a lead.",
  },
  {
    title: "DCFS Foster Care",
    href: "https://dcfs.illinois.gov/loving-homes/fostercare.html",
    desc: "The official DCFS hub for licensing and program info.",
  },
  {
    title: "DCFS Licensing Application Portal",
    href: "https://www2.illinois.gov/dcfs/lovinghomes/LEQ/Pages/index1.html",
    desc: "Where a prospective foster parent logs on to check if they qualify and begin the process — orientation, training, background checks, home study.",
  },
];

/** Shared external-resources footer, rendered on both the personal and admin
 * dashboards. */
export function UsefulLinks() {
  return (
    <>
      <h2 style={{ fontSize: "1.1rem", margin: "2.5rem 0 0.75rem" }}>Useful links</h2>
      <ul className="links-list">
        {LINKS.map((l) => (
          <li key={l.href} className="links-item">
            <a href={l.href} target="_blank" rel="noopener noreferrer" className="links-title">
              {l.title}
            </a>
            <span className="links-desc">{l.desc}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
