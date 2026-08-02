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
//
// "supported" and "available" mean the same thing (a real value came
// back) — both exist because Instagram's own task specified "supported"
// and the later Facebook Page Insights task explicitly specified
// "available" as its exact status vocabulary. Rather than fork a
// near-duplicate status type per platform, this one union carries both
// spellings; each connector uses the one its own task specified.
export type MetricRecordStatus =
  | "supported"
  | "available"
  | "empty"
  | "unsupported"
  | "invalidForContentType"
  | "permissionRequired"
  | "accessReviewRequired"
  | "deprecated"
  | "untested"
  | "providerError"
  // Contextual, distribution-eligibility-specific states — kept distinct
  // from the generic "unsupported" because the underlying cause is known
  // and proven (a specific Meta error, not a rejection of unknown
  // origin), and because it is an expected non-error state for content
  // that was never distributed to/crossposted on Facebook, not a
  // failure. See InstagramConnector's refineReelMetricStatus.
  | "noFacebookDistribution"
  | "notCrossposted"
  // A metric name that is not valid for the API model actually used to
  // request it (distinct from "deprecated", which implies it once
  // worked and was later withdrawn).
  | "invalidForApiModel"
  // Capability genuinely not yet determined — no live evidence exists
  // either way. Distinct from "untested" (no candidate has ever been
  // documented) in that this covers a documented candidate that simply
  // has not been exercised against real content yet.
  | "eligibilityUnknown";

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
  // Longer, metric-specific human-readable explanation for a
  // non-value-bearing status — e.g. why "plays" has no value when
  // "views" does, or why "facebook_views" has none for this specific
  // media. Optional: most statuses are adequately explained by their
  // generic label alone.
  safeReasonMessage?: string;
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
  // Additive, optional fields populated by Instagram's and Facebook's
  // own structured metric pipelines (see InstagramConnector and
  // FacebookConnector) — Pinterest snapshots simply omit them, so no
  // migration or behavior change is required for it. `providerMediaType`/
  // `providerMediaProductType` are Instagram's raw provider fields;
  // `providerObjectType` is Facebook's (its post `type`/`status_type`).
  accountType?: string;
  contentType?: ContentType;
  providerMediaType?: string;
  providerMediaProductType?: string;
  providerObjectType?: string;
  metricRecords?: MetricRecord[];
  createdAt: string;
  updatedAt: string;
}
