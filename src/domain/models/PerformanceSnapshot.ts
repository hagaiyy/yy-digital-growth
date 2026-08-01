import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";

// "untested" covers a content type/metric with no live-verified or
// documented candidate at all (e.g. a Story before any real Story
// object has ever been imported) — distinct from "unavailable", which
// means a real request was made and nothing came back.
export type DataCompleteness = "complete" | "partial" | "unavailable" | "untested";

// Full per-metric provenance record — one entry per metric that was
// actually attempted, regardless of outcome. Keeps the provider's own
// metric name distinct from our internal name, the unit Meta actually
// returned distinct from any normalized unit, and a closed status
// instead of collapsing every non-success case into "missing".
export type MetricRecordStatus =
  | "supported"
  | "empty"
  | "unsupported"
  | "invalidForContentType"
  | "permissionRequired"
  | "accessReviewRequired"
  | "deprecated"
  | "untested"
  | "providerError";

export interface MetricRecord {
  providerMetric: string;
  internalMetric: string;
  value: number | string | null;
  nativeUnit: string;
  normalizedValue?: number | string | null;
  normalizedUnit?: string;
  status: MetricRecordStatus;
  period?: string;
  sourceEndpoint: string;
  safeReasonCode?: string;
}

export interface PerformanceSnapshot {
  schemaVersion: "1.0.0";
  performanceSnapshotId: string;
  importedContentId: string;
  connectionId: string;
  platform: Platform;
  snapshotHour: string;
  collectedAt: string;
  // A key absent here was never returned by the platform; a value of
  // `null` means the platform explicitly reported it unavailable; `0`
  // is a real observed zero. Never collapse these into each other.
  metrics: Record<string, number | string | null>;
  dataCompleteness: DataCompleteness;
  // Additive, optional fields populated by Instagram's structured
  // metric pipeline only (see InstagramConnector.fetchContentMetrics) —
  // Facebook and Pinterest snapshots simply omit them, so no migration
  // or behavior change is required for either.
  accountType?: string;
  contentType?: ContentType;
  providerMediaType?: string;
  providerMediaProductType?: string;
  metricRecords?: MetricRecord[];
  createdAt: string;
  updatedAt: string;
}
