"use client";

import type { ImportRun } from "@/domain/models/ImportRun";
import { CONNECTION_LABELS } from "@/components/connectionLabels";

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US");
}

// The full import-run detail — every field the old inline "Last import
// summary" block used to render unconditionally. Nothing here was
// removed, only relocated behind the compact ImportStatusIndicator.
export function ImportSummaryModal({ importRun, onClose }: { importRun: ImportRun | null; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Import summary</h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {!importRun && <p>No import has run yet.</p>}

        {importRun && (
          <div>
            <dl className="detail-grid">
              <dt>Status</dt>
              <dd>{importRun.status}</dd>
              <dt>Started</dt>
              <dd>{formatTimestamp(importRun.startedAt)}</dd>
              <dt>Completed</dt>
              <dd>{formatTimestamp(importRun.completedAt)}</dd>
              <dt>Recent Content Limit used</dt>
              <dd>{importRun.recentContentLimit}</dd>
              <dt>Connections</dt>
              <dd>{importRun.totals.connections}</dd>
              <dt>Requested items</dt>
              <dd>{importRun.totals.requestedItems}</dd>
              <dt>Created</dt>
              <dd>{importRun.totals.createdItems}</dd>
              <dt>Updated</dt>
              <dd>{importRun.totals.updatedItems}</dd>
              <dt>Failed</dt>
              <dd>{importRun.totals.failedItems}</dd>
              <dt>Skipped</dt>
              <dd>{importRun.totals.skippedItems}</dd>
            </dl>

            {importRun.safeErrorMessage && <p className="text-danger">{importRun.safeErrorMessage}</p>}

            <h3>Per-connection results</h3>
            {importRun.connectionResults.map((result) => (
              <div key={result.connectionId} className="card" style={{ marginBottom: "0.5rem" }}>
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>{CONNECTION_LABELS[result.connectionId] ?? result.platform}</strong> — {result.status}
                  {typeof result.requestedCount === "number" && (
                    <>
                      {" "}
                      (requested {result.requestedCount}, created {result.createdCount ?? 0}, updated{" "}
                      {result.updatedCount ?? 0}, failed {result.failedCount ?? 0}, skipped {result.skippedCount ?? 0})
                    </>
                  )}
                </p>
                {result.safeErrorMessage && <p className="text-warning">{result.safeErrorMessage}</p>}
                {result.itemResults && result.itemResults.length > 0 && (
                  <ul>
                    {result.itemResults.map((item, index) => (
                      <li key={`${item.externalContentId ?? index}`}>
                        [{item.status}] {item.contentLabel ?? item.externalContentId ?? "unknown item"}
                        {item.safeMessage ? ` — ${item.safeMessage}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
