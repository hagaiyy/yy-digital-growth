import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import { INSTAGRAM_METRIC_CAPABILITY_REGISTRY } from "@/application/connectors/instagram/metricCapabilityRegistry";
import { FACEBOOK_METRIC_CAPABILITY_REGISTRY } from "@/application/connectors/facebook/metricCapabilityRegistry";

export interface RelevantMetric {
  internalMetric: string;
  nativeUnit: string;
  normalizedUnit?: string;
  canonicalStatus: MetricRecordStatus;
  // The registry's own safeLimitation note, if any — used as the UI's
  // fallback explanation when no live snapshot has recorded this metric
  // yet (a live MetricRecord's own safeReasonMessage always takes
  // precedence over this once one exists).
  reason?: string;
}

// "invalidForContentType" means the registry has already proven, live,
// that a metric categorically does not apply to this specific content
// type (e.g. Instagram "impressions" on a Reel) — it is excluded
// entirely from the relevant-metric list, never shown even as
// "unsupported". Every other status (including "untested" and
// "deprecated") is still a real, relevant fact about this content type
// and stays visible.
const EXCLUDED_STATUSES: MetricRecordStatus[] = ["invalidForContentType"];

// Reads only from the two hand-maintained metric capability registries
// (Instagram + Facebook) — this never touches provider-request logic or
// the registries' own status values, it only filters/dedupes them into
// "what metrics can legitimately appear in a table for this platform +
// content type". Pinterest has no registry yet, so it yields no rows.
export function getRelevantMetricsForContentType(platform: Platform, contentType: ContentType): RelevantMetric[] {
  const result: RelevantMetric[] = [];
  const seen = new Set<string>();

  const pushEntry = (entry: {
    internalMetric: string;
    nativeUnit: string;
    normalizedUnit?: string;
    status: MetricRecordStatus;
    safeLimitation?: string;
  }) => {
    if (EXCLUDED_STATUSES.includes(entry.status)) return;
    if (seen.has(entry.internalMetric)) return;
    seen.add(entry.internalMetric);
    result.push({
      internalMetric: entry.internalMetric,
      nativeUnit: entry.nativeUnit,
      normalizedUnit: entry.normalizedUnit,
      canonicalStatus: entry.status,
      reason: entry.safeLimitation,
    });
  };

  if (platform === "instagram") {
    for (const entry of INSTAGRAM_METRIC_CAPABILITY_REGISTRY) {
      if (entry.scope === "media" && entry.contentType === contentType) pushEntry(entry);
    }
  } else if (platform === "facebook") {
    for (const entry of FACEBOOK_METRIC_CAPABILITY_REGISTRY) {
      if (entry.scope === "post" && entry.contentType === contentType) pushEntry(entry);
    }
  }

  return result;
}
