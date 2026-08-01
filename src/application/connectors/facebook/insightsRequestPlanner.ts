import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import { FACEBOOK_METRIC_CAPABILITY_REGISTRY, type MetricCapabilityEntry } from "./metricCapabilityRegistry";

// A deterministic lookup + filter over the metric capability registry —
// not a rules engine. Given the same inputs it always returns the same
// plan; every decision traces back to one registry entry's status.

export interface PlannedMetric {
  providerMetric: string;
  internalMetric: string;
  endpoint: string;
  nativeUnit: string;
  normalizedUnit?: string;
  period?: string;
  status: MetricRecordStatus;
}

export interface ExcludedMetric {
  providerMetric: string;
  internalMetric: string;
  nativeUnit: string;
  endpoint: string;
  reason: MetricRecordStatus;
  safeLimitation?: string;
}

// Statuses the registry can carry that mean "do not send this request —
// we already know, from documentation or a prior live response, that it
// cannot succeed right now." `permissionRequired` is included because,
// unlike the generic permission-grant check below (which only compares
// against this app's currently *requested* OAuth scopes), a registry
// entry only carries this status once a real production response has
// confirmed the gap is a permission this task is not allowed to request
// (e.g. likes.summary/comments.summary needing pages_read_user_content)
// — retrying it would only ever reproduce the same rejection. Every
// other status (available, empty, untested, providerError) is still
// worth a real attempt.
const NEVER_REQUEST_STATUSES: ReadonlySet<MetricRecordStatus> = new Set([
  "unsupported",
  "invalidForContentType",
  "deprecated",
  "accessReviewRequired",
  "permissionRequired",
]);

function hasPermission(required: string, granted: string[]): boolean {
  return granted.includes(required);
}

function toPlanned(entry: MetricCapabilityEntry): PlannedMetric {
  return {
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: entry.endpoint,
    nativeUnit: entry.nativeUnit,
    normalizedUnit: entry.normalizedUnit,
    period: entry.period,
    status: entry.status,
  };
}

function toExcluded(entry: MetricCapabilityEntry, reason: MetricRecordStatus): ExcludedMetric {
  return {
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    nativeUnit: entry.nativeUnit,
    endpoint: entry.endpoint,
    reason,
    safeLimitation: entry.safeLimitation,
  };
}

function isObjectFieldSourced(entry: MetricCapabilityEntry): boolean {
  return entry.endpoint === "/{post-id}";
}

export interface PostInsightsPlanInput {
  contentType: ContentType;
  grantedPermissions: string[];
}

export interface PostInsightsPlan {
  // Engagement counters (likes/comments/shares) live on the post object
  // itself, one field at a time — proven, live-tested behavior: a
  // rejected field there must never be combined with others, since one
  // gated field could otherwise take the whole object request down.
  objectFieldEndpoint: string;
  objectFieldMetrics: PlannedMetric[];
  // Distribution/performance/video metrics come from /insights,
  // combined-first and bisected by the connector only if the combined
  // call itself is rejected.
  insightsEndpoint: string;
  insightsMetrics: PlannedMetric[];
  // Metrics the registry has proven need their own request regardless
  // of the combined insights call's outcome (none confirmed yet).
  independentInsightsMetrics: PlannedMetric[];
  // Known in advance, from the registry (mostly Meta's June 2026
  // Page Insights deprecations), never to be requested at all.
  excludedMetrics: ExcludedMetric[];
}

export function planFacebookPostInsightsRequest(input: PostInsightsPlanInput): PostInsightsPlan {
  const candidates = FACEBOOK_METRIC_CAPABILITY_REGISTRY.filter(
    (entry) => entry.scope === "post" && entry.contentType === input.contentType,
  );

  const objectFieldMetrics: PlannedMetric[] = [];
  const insightsMetrics: PlannedMetric[] = [];
  const independentInsightsMetrics: PlannedMetric[] = [];
  const excludedMetrics: ExcludedMetric[] = [];

  for (const entry of candidates) {
    if (!hasPermission(entry.requiredPermission, input.grantedPermissions)) {
      excludedMetrics.push(toExcluded(entry, "permissionRequired"));
      continue;
    }
    if (NEVER_REQUEST_STATUSES.has(entry.status)) {
      excludedMetrics.push(toExcluded(entry, entry.status));
      continue;
    }
    const planned = toPlanned(entry);
    if (isObjectFieldSourced(entry)) {
      objectFieldMetrics.push(planned);
    } else if (entry.requiresIndependentRequest) {
      independentInsightsMetrics.push(planned);
    } else {
      insightsMetrics.push(planned);
    }
  }

  return {
    objectFieldEndpoint: "/{post-id}",
    objectFieldMetrics,
    insightsEndpoint: "/{post-id}/insights",
    insightsMetrics,
    independentInsightsMetrics,
    excludedMetrics,
  };
}

export interface PageInsightsPlanInput {
  grantedPermissions: string[];
}

export interface PageInsightsPlan {
  endpoint: string;
  period: string;
  metrics: PlannedMetric[];
  excludedMetrics: ExcludedMetric[];
}

export function planFacebookPageInsightsRequest(input: PageInsightsPlanInput): PageInsightsPlan {
  const candidates = FACEBOOK_METRIC_CAPABILITY_REGISTRY.filter((entry) => entry.scope === "page");

  const metrics: PlannedMetric[] = [];
  const excludedMetrics: ExcludedMetric[] = [];

  for (const entry of candidates) {
    if (!hasPermission(entry.requiredPermission, input.grantedPermissions)) {
      excludedMetrics.push(toExcluded(entry, "permissionRequired"));
      continue;
    }
    if (NEVER_REQUEST_STATUSES.has(entry.status)) {
      excludedMetrics.push(toExcluded(entry, entry.status));
      continue;
    }
    metrics.push(toPlanned(entry));
  }

  return {
    endpoint: "/{page-id}/insights",
    period: "day",
    metrics,
    excludedMetrics,
  };
}
