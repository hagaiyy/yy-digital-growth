"use client";

import { useEffect, useState } from "react";

import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { PerformanceTableData, TableMetricCell, TableRow, TableTimeframeCell } from "@/application/services/PerformanceViewService";
import { TIMEFRAME_KEYS, TIMEFRAME_LABELS, type TimeframeKey } from "@/application/performance/timeframeSnapshotSelection";
import { humanizeInternalMetricName } from "@/application/performance/labels";
import { formatMetricDisplayValue, stripMillisecondLabelSuffix } from "@/application/performance/metricValueFormatting";
import { METRIC_STATUS_TONE } from "@/components/performance/metricStatusStyles";
import { hasAdditionalExplanation, resolveInlineStatusLabel } from "@/application/performance/metricIssueDisplay";
import { MetricIssueIndicator } from "@/components/performance/MetricIssueIndicator";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "The request failed.");
  }
  return body as T;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// Full caption/hashtag text, never truncated with an ellipsis — the
// content column wraps and the row grows to fit it (see .content-caption
// and .performance-table td in globals.css).
function contentCaptionText(row: TableRow): string {
  return row.title || row.caption || "(no caption)";
}

function MetricRow({ cell }: { cell: TableMetricCell }) {
  const tone = METRIC_STATUS_TONE[cell.status];
  const isValueBearing = cell.status === "available" || cell.status === "supported";
  // Always a short, fixed label inline — the long registry/connector
  // explanation (cell.reason) never renders directly in the row; it
  // only ever appears inside MetricIssueIndicator's tooltip.
  const inlineLabel = resolveInlineStatusLabel(cell.internalMetric, cell.status);
  const label = stripMillisecondLabelSuffix(humanizeInternalMetricName(cell.internalMetric), cell.nativeUnit);
  const showIssueIndicator = hasAdditionalExplanation(cell.reason, inlineLabel, isValueBearing);
  return (
    <div className="metric-row">
      <span className={`status-dot status-dot-${tone}`} />
      <span className="metric-row-label">{label}</span>
      <span className="metric-row-value">
        {isValueBearing ? formatMetricDisplayValue(cell.value, cell.nativeUnit) : <span className="text-muted">{inlineLabel}</span>}
      </span>
      {showIssueIndicator && cell.reason && <MetricIssueIndicator message={cell.reason} metricLabel={label} />}
    </div>
  );
}

function TimeframeCell({ cell, hiddenMetrics }: { cell: TableTimeframeCell; hiddenMetrics: Set<string> }) {
  if (!cell.hasSnapshot) {
    return <div className="timeframe-cell text-muted">No data saved for timeframe</div>;
  }
  const visibleMetrics = cell.metrics.filter((m) => !hiddenMetrics.has(m.internalMetric));
  return (
    <div className="timeframe-cell" title={`Collected: ${formatDate(cell.collectedAt)}`}>
      {visibleMetrics.length === 0 ? (
        <span className="text-muted">All metrics hidden</span>
      ) : (
        visibleMetrics.map((metric) => <MetricRow key={metric.internalMetric} cell={metric} />)
      )}
    </div>
  );
}

export function PerformanceTable({ platform, contentType }: { platform: Platform; contentType: ContentType }) {
  const [table, setTable] = useState<PerformanceTableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenMetrics, setHiddenMetrics] = useState<string[]>([]);
  const [unhidePanelOpen, setUnhidePanelOpen] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  useEffect(() => {
    setTable(null);
    setError(null);
    setUnhidePanelOpen(false);

    void apiFetch<PerformanceTableData>(
      `/api/performance/table?platform=${encodeURIComponent(platform)}&contentType=${encodeURIComponent(contentType)}`,
    )
      .then(setTable)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the performance table."));

    void apiFetch<{ hiddenMetrics: string[] }>(
      `/api/performance/metric-visibility?platform=${encodeURIComponent(platform)}&contentType=${encodeURIComponent(contentType)}`,
    )
      .then((body) => setHiddenMetrics(body.hiddenMetrics))
      .catch(() => {
        // Visibility preferences are a display-only nicety — if they
        // fail to load, every metric simply stays shown (the safe
        // default), never blocking the table itself.
      });
  }, [platform, contentType]);

  async function persistHiddenMetrics(next: string[]) {
    setHiddenMetrics(next);
    setSavingVisibility(true);
    try {
      await apiFetch("/api/performance/metric-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, contentType, hiddenMetrics: next }),
      });
    } catch {
      // Display-only preference — a failed save leaves the current
      // session's view correct; it just won't survive a reload.
    } finally {
      setSavingVisibility(false);
    }
  }

  function hideMetric(internalMetric: string) {
    if (hiddenMetrics.includes(internalMetric)) return;
    void persistHiddenMetrics([...hiddenMetrics, internalMetric]);
  }

  function unhideMetric(internalMetric: string) {
    void persistHiddenMetrics(hiddenMetrics.filter((m) => m !== internalMetric));
  }

  function unhideAll() {
    void persistHiddenMetrics([]);
  }

  if (error) return <p className="text-danger">{error}</p>;
  if (!table) return <p>Loading performance data…</p>;

  const hiddenSet = new Set(hiddenMetrics);
  const visibleMetrics = table.relevantMetrics.filter((m) => !hiddenSet.has(m.internalMetric));
  const hiddenMetricDefs = table.relevantMetrics.filter((m) => hiddenSet.has(m.internalMetric));

  return (
    <div>
      <div className="metric-visibility-toolbar">
        {visibleMetrics.map((metric) => (
          <button
            key={metric.internalMetric}
            type="button"
            className="metric-chip"
            disabled={savingVisibility}
            onClick={() => hideMetric(metric.internalMetric)}
            title="Hide this metric from this tab"
          >
            {humanizeInternalMetricName(metric.internalMetric)}
            <span className="metric-chip-remove">×</span>
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => setUnhidePanelOpen((open) => !open)}
          disabled={hiddenMetricDefs.length === 0}
        >
          Unhide metrics{hiddenMetricDefs.length > 0 ? ` (${hiddenMetricDefs.length})` : ""}
        </button>
      </div>

      {unhidePanelOpen && (
        <div className="unhide-panel">
          {hiddenMetricDefs.length === 0 ? (
            <span className="text-muted">No hidden metrics.</span>
          ) : (
            <>
              {hiddenMetricDefs.map((metric) => (
                <button
                  key={metric.internalMetric}
                  type="button"
                  className="metric-chip metric-chip-hidden"
                  disabled={savingVisibility}
                  onClick={() => unhideMetric(metric.internalMetric)}
                  title="Restore this metric to this tab"
                >
                  {humanizeInternalMetricName(metric.internalMetric)}
                  <span className="metric-chip-remove">+</span>
                </button>
              ))}
              <button type="button" className="btn btn-secondary btn-small" onClick={unhideAll} disabled={savingVisibility}>
                Show all
              </button>
            </>
          )}
        </div>
      )}

      {table.rows.length === 0 ? (
        <p>No content in this tab yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="performance-table">
            <thead>
              <tr>
                <th className="col-content">Content</th>
                <th className="col-published">Published</th>
                {TIMEFRAME_KEYS.map((key: TimeframeKey) => (
                  <th key={key}>{TIMEFRAME_LABELS[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.importedContentId}>
                  <td className="col-content">
                    <div className="content-cell">
                      {row.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.thumbnailUrl} alt="" className="content-thumbnail" />
                      ) : (
                        <div className="content-thumbnail content-thumbnail-placeholder" aria-hidden="true">
                          {platform.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="content-caption">
                        {row.permalink ? (
                          <a href={row.permalink} target="_blank" rel="noreferrer">
                            {contentCaptionText(row)}
                          </a>
                        ) : (
                          contentCaptionText(row)
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="col-published">{formatDate(row.publishedAt)}</td>
                  {TIMEFRAME_KEYS.map((key: TimeframeKey) => (
                    <td key={key}>
                      <TimeframeCell cell={row.timeframes[key]} hiddenMetrics={hiddenSet} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
