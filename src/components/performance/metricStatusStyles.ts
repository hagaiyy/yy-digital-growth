import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";

export type StatusTone = "success" | "warning" | "danger" | "muted";

// Four tones only (per the visual design constraints): green=success,
// amber=partial/needs-action, red=failure, gray=unavailable/missing.
// "invalidForContentType" never actually reaches the UI (relevantMetrics
// excludes it upstream) but is mapped defensively so this table stays
// exhaustive over MetricRecordStatus.
export const METRIC_STATUS_TONE: Record<MetricRecordStatus, StatusTone> = {
  supported: "success",
  available: "success",
  empty: "muted",
  unsupported: "danger",
  invalidForContentType: "muted",
  permissionRequired: "warning",
  accessReviewRequired: "warning",
  deprecated: "muted",
  untested: "muted",
  providerError: "danger",
  // Neutral/gray, not red: these mean "not eligible for this specific
  // item right now", a known and expected non-error state, never a
  // failure — reserving red strictly for actual request failures.
  noFacebookDistribution: "muted",
  notCrossposted: "muted",
  invalidForApiModel: "muted",
  eligibilityUnknown: "muted",
};

export const METRIC_STATUS_LABEL: Record<MetricRecordStatus, string> = {
  supported: "Available",
  available: "Available",
  empty: "No data returned",
  unsupported: "Unsupported",
  invalidForContentType: "Not applicable",
  permissionRequired: "Permission required",
  accessReviewRequired: "Access review required",
  deprecated: "Deprecated",
  untested: "Untested",
  providerError: "Provider request failed",
  noFacebookDistribution: "No Facebook distribution for this media",
  notCrossposted: "This item was not crossposted to Facebook",
  invalidForApiModel: "Not available via this API model",
  eligibilityUnknown: "Eligibility not yet verified",
};
