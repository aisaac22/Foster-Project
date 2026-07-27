"use client";

import { useEffect, useRef, useState } from "react";
import { uploadCsvIngest, type IngestActionResult } from "@/app/admin/ingest-actions";

/**
 * Admin-only floating action button, bottom-right, opening a modal for
 * uploading a new CSV snapshot — the web equivalent of
 * `npx tsx scripts/ingest.ts`, without needing a terminal.
 */
export function CsvUploadButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<IngestActionResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const formData = new FormData(e.currentTarget);
    const res = await uploadCsvIngest(formData);
    setPending(false);
    setResult(res);
    if (res.ok) formRef.current?.reset();
  }

  return (
    <>
      <button
        type="button"
        className="fab"
        onClick={() => setOpen(true)}
        aria-label="Upload CSV data"
        title="Upload CSV data"
      >
        ⇧
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Upload CSV data"
          >
            <div className="modal-panel-header">
              <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Upload CSV data</h2>
              <button type="button" className="modal-close" onClick={close} aria-label="Close">
                ×
              </button>
            </div>
            <p className="subtitle" style={{ marginTop: "0.35rem", marginBottom: "1rem" }}>
              Loads a new snapshot — validated and transactional, same as the
              CLI ingest. Leave a file blank to skip it.
            </p>

            <form ref={formRef} onSubmit={handleSubmit} className="contact-form" style={{ maxWidth: "100%" }}>
              <label>
                Snapshot date
                <input type="date" name="snapshot_date" required />
              </label>
              <label>
                Children CSV
                <input type="file" name="children" accept=".csv" />
              </label>
              <label>
                Providers CSV
                <input type="file" name="providers" accept=".csv" />
              </label>
              <label>
                Placements CSV
                <input type="file" name="placements" accept=".csv" />
              </label>
              <button type="submit" disabled={pending}>
                {pending ? "Uploading…" : "Upload"}
              </button>
            </form>

            {result && (
              <p className={result.ok ? "upload-result-ok" : "upload-result-error"}>
                {result.message}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
