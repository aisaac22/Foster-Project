import { query } from "@/lib/db";
import { logContact } from "./actions";

interface Contact {
  id: string;
  contacted_at: string;
  logged_by_name: string | null;
  outcome: string;
  note: string | null;
  follow_up_on: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  reached: "Reached",
  no_answer: "No answer",
  re_engaged: "Re-engaged",
  plans_to_close: "Plans to close",
  other: "Other",
};

const fmtWhen = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * Contact panel for one home: a form to log a new contact, and the history of
 * prior contacts. Rendered inside the provider detail page.
 */
export async function ContactPanel({ idProvider }: { idProvider: string }) {
  const contacts = await query<Contact>(
    `select id, contacted_at, logged_by_name, outcome, note, follow_up_on
     from provider_contacts
     where id_provider = $1
     order by contacted_at desc`,
    [idProvider],
  );

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        Retention contacts
      </h2>

      {/* Log form — posts straight to the Server Action */}
      <form action={logContact} className="contact-form">
        <input type="hidden" name="id_provider" value={idProvider} />
        <div className="contact-row">
          <label>
            Outcome
            <select name="outcome" required defaultValue="">
              <option value="" disabled>Select…</option>
              <option value="reached">Reached</option>
              <option value="no_answer">No answer</option>
              <option value="re_engaged">Re-engaged</option>
              <option value="plans_to_close">Plans to close</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Follow up on
            <input type="date" name="follow_up_on" />
          </label>
        </div>
        <label>
          Note
          <textarea name="note" rows={2} placeholder="What was discussed…" />
        </label>
        <button type="submit">Log contact</button>
      </form>

      {/* History */}
      {contacts.length === 0 ? (
        <p className="empty" style={{ paddingTop: "1rem" }}>
          No contacts logged yet.
        </p>
      ) : (
        <table className="data-table" style={{ marginTop: "1.25rem" }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Outcome</th>
              <th>By</th>
              <th>Note</th>
              <th>Follow up</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>{fmtWhen(c.contacted_at)}</td>
                <td>{OUTCOME_LABELS[c.outcome] ?? c.outcome}</td>
                <td>{c.logged_by_name ?? "—"}</td>
                <td>{c.note ?? "—"}</td>
                <td>{c.follow_up_on ? fmtWhen(c.follow_up_on) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
