import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import {
  INSTAGRAM_METRIC_CAPABILITY_REGISTRY,
  type MetricCapabilityEntry,
  type RegistryAccountType,
} from "./metricCapabilityRegistry";

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
  breakdown?: string;
  timeframe?: string;
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
// cannot succeed right now." Every other status (supported, empty,
// untested, providerError) is still worth a real attempt.
const NEVER_REQUEST_STATUSES: ReadonlySet<MetricRecordStatus> = new Set([
  "unsupported",
  "invalidForContentType",
  "deprecated",
  "accessReviewRequired",
  // A metric that does not exist for this API model at all (e.g.
  // Threads-only metrics rejected on Instagram API with Instagram
  // Login) is exactly as permanent as "deprecated" — re-requesting it
  // every import would only ever repeat the same rejection.
  "invalidForApiModel",
]);

function hasEveryPermission(required: string[], granted: string[]): boolean {
  return required.every((permission) => granted.includes(permission));
}

export interface MediaInsightsPlanInput {
  accountType: RegistryAccountType;
  contentType: ContentType;
  grantedPermissions: string[];
}

export interface MediaInsightsPlan {
  endpoint: string;
  // Requested together in one call first (combined-first, bisected on
  // failure by the connector — see InstagramConnector.fetchContentMetrics).
  metricsToRequest: PlannedMetric[];
  // Metrics the registry has proven need their own request regardless of
  // whether the combined call would otherwise succeed (none confirmed
  // yet for media — every rejection seen so far is explained by
  // per-content-type validity, which combined-first/bisect already
  // isolates without needing a standing exception here).
  independentMetrics: PlannedMetric[];
  // Metrics already available for free from content discovery — never
  // re-requested via /insights.
  freeMetricsFromDiscovery: PlannedMetric[];
  // Known in advance, from the registry, never to be requested at all.
  excludedMetrics: ExcludedMetric[];
}

export function planInstagramMediaInsightsRequest(input: MediaInsightsPlanInput): MediaInsightsPlan {
  const candidates = INSTAGRAM_METRIC_CAPABILITY_REGISTRY.filter(
    (entry) =>
      entry.scope === "media" &&
      entry.contentType === input.contentType &&
      (entry.accountType === "any" || entry.accountType === input.accountType),
  );

  const metricsToRequest: PlannedMetric[] = [];
  const independentMetrics: PlannedMetric[] = [];
  const freeMetricsFromDiscovery: PlannedMetric[] = [];
  const excludedMetrics: ExcludedMetric[] = [];

  for (const entry of candidates) {
    if (!hasEveryPermission(entry.requiredPermissions, input.grantedPermissions)) {
      excludedMetrics.push(toExcluded(entry, "permissionRequired"));
      continue;
    }
    if (NEVER_REQUEST_STATUSES.has(entry.status)) {
      excludedMetrics.push(toExcluded(entry, entry.status));
      continue;
    }
    const planned = toPlanned(entry);
    if (isDiscoverySourced(entry)) {
      freeMetricsFromDiscovery.push(planned);
    } else if (entry.requiresIndependentRequest) {
      independentMetrics.push(planned);
    } else {
      metricsToRequest.push(planned);
    }
  }

  return {
    endpoint: "/{media-id}/insights",
    metricsToRequest,
    independentMetrics,
    freeMetricsFromDiscovery,
    excludedMetrics,
  };
}

export interface AccountInsightsPlanInput {
  accountType: RegistryAccountType;
  grantedPermissions: string[];
}

// One request group per distinct (period, breakdown, timeframe) shape —
// Meta requires every metric in a single call to share the same
// parameters, so metrics that need different ones can never be combined.
export interface AccountInsightsRequestGroup {
  period: string;
  breakdown?: string;
  timeframe?: string;
  // True for metrics whose period is a rolling day-count that needs a
  // concrete since/until date range computed at request time (the
  // registry only records the parameter *shape*, not literal dates).
  requiresDateRange: boolean;
  metrics: PlannedMetric[];
}

export interface AccountInsightsPlan {
  endpoint: string;
  requestGroups: AccountInsightsRequestGroup[];
  excludedMetrics: ExcludedMetric[];
}

export function planInstagramAccountInsightsRequest(input: AccountInsightsPlanInput): AccountInsightsPlan {
  const candidates = INSTAGRAM_METRIC_CAPABILITY_REGISTRY.filter(
    (entry) =>
      entry.scope === "account" && (entry.accountType === "any" || entry.accountType === input.accountType),
  );

  const excludedMetrics: ExcludedMetric[] = [];
  const groups = new Map<string, AccountInsightsRequestGroup>();

  for (const entry of candidates) {
    if (!hasEveryPermission(entry.requiredPermissions, input.grantedPermissions)) {
      excludedMetrics.push(toExcluded(entry, "permissionRequired"));
      continue;
    }
    if (NEVER_REQUEST_STATUSES.has(entry.status)) {
      excludedMetrics.push(toExcluded(entry, entry.status));
      continue;
    }
    const groupKey = `${entry.period ?? ""}::${entry.breakdown ?? ""}::${entry.timeframe ?? ""}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        period: entry.period ?? "day",
        breakdown: entry.breakdown,
        timeframe: entry.timeframe,
        requiresDateRange: entry.timeframe === undefined,
        metrics: [],
      };
      groups.set(groupKey, group);
    }
    group.metrics.push(toPlanned(entry));
  }

  return {
    endpoint: "/{ig-user-id}/insights",
    requestGroups: Array.from(groups.values()),
    excludedMetrics,
  };
}

function isDiscoverySourced(entry: MetricCapabilityEntry): boolean {
  return entry.endpoint === "/{ig-user-id}/media";
}

function toPlanned(entry: MetricCapabilityEntry): PlannedMetric {
  return {
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: entry.endpoint,
    nativeUnit: entry.nativeUnit,
    normalizedUnit: entry.normalizedUnit,
    period: entry.period,
    breakdown: entry.breakdown,
    timeframe: entry.timeframe,
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
