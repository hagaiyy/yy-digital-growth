import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import { METRIC_STATUS_LABEL } from "@/components/performance/metricStatusStyles";

// Metric-specific short inline overrides — kept separate from the
// generic per-status label because "plays"/"facebookViews"/
// "crosspostedViews" must show this exact literal phrase in the table,
// distinct from other metrics that happen to share the same underlying
// status (e.g. Facebook's post_impressions is also "deprecated" but
// keeps its own generic label).
const INLINE_LABEL_OVERRIDES: Record<string, string> = {
  plays: "Not available through current API",
  facebookViews: "Not available through current API",
  crosspostedViews: "Not available through current API",
};

// The short label always shown inline in the table cell — never the
// long registry/connector explanation.
export function resolveInlineStatusLabel(internalMetric: string, status: MetricRecordStatus): string {
  return INLINE_LABEL_OVERRIDES[internalMetric] ?? METRIC_STATUS_LABEL[status];
}

// The issue/info indicator is worth showing only when there is more
// detail available than what's already visible inline — never for a
// metric with no stored explanation at all (a normal healthy metric
// with a plain value), and never merely to repeat the same short label
// a second time behind an icon.
export function hasAdditionalExplanation(reason: string | undefined, inlineLabel: string): boolean {
  return Boolean(reason) && reason !== inlineLabel;
}
