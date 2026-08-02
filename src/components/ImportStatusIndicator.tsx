"use client";

import { useState } from "react";

import type { ImportRun, ImportRunStatus } from "@/domain/models/ImportRun";
import { formatRelativeTime } from "@/components/formatRelativeTime";
import { ImportSummaryModal } from "@/components/ImportSummaryModal";

const STATUS_DOT_CLASS: Record<ImportRunStatus, string> = {
  completed: "status-dot-success",
  completedWithErrors: "status-dot-warning",
  failed: "status-dot-danger",
  running: "status-dot-muted",
};

// Counts items whose OWN result (not the connection-level aggregate) was
// "partial" or "failed" — the same authoritative per-item status the
// full modal already lists, so the compact count and the detail view
// can never disagree.
function countPartialOrFailedItems(importRun: ImportRun): number {
  let count = 0;
  for (const connectionResult of importRun.connectionResults) {
    for (const item of connectionResult.itemResults ?? []) {
      if (item.status === "partial" || item.status === "failed") count += 1;
    }
  }
  return count;
}

export function ImportStatusIndicator({ importRun }: { importRun: ImportRun | null }) {
  const [modalOpen, setModalOpen] = useState(false);

  const changedCount = importRun ? importRun.totals.createdItems + importRun.totals.updatedItems : 0;
  const partialOrFailedCount = importRun ? countPartialOrFailedItems(importRun) : 0;

  return (
    <>
      <button type="button" className="import-status-indicator" onClick={() => setModalOpen(true)}>
        <span className={`status-dot ${importRun ? STATUS_DOT_CLASS[importRun.status] : "status-dot-muted"}`} />
        <span className="import-status-indicator-text">
          {!importRun && <span>No import has run yet</span>}
          {importRun && (
            <>
              <span>
                {importRun.status === "running"
                  ? "Import in progress…"
                  : `Data updated ${formatRelativeTime(importRun.completedAt ?? importRun.startedAt)}`}
              </span>
              <span>{changedCount} items updated</span>
              {partialOrFailedCount > 0 && <span>{partialOrFailedCount} items with partial data</span>}
            </>
          )}
        </span>
      </button>
      {modalOpen && <ImportSummaryModal importRun={importRun} onClose={() => setModalOpen(false)} />}
    </>
  );
}
