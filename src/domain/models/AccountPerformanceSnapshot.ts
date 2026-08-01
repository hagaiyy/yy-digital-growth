import type { Platform } from "@/domain/models/PlatformConnection";
import type { DataCompleteness, MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";

// Account-level metrics (audience demographics, follower counts, profile
// activity) are never mixed into a content performanceSnapshot — they
// describe the account as a whole, not one piece of content, and Meta
// requests them from a completely different endpoint with different
// parameters (period/breakdown/timeframe instead of a single content id).
export interface AccountMetricRecord {
  providerMetric: string;
  internalMetric: string;
  value: number | string | null;
  nativeUnit: string;
  normalizedValue?: number | string | null;
  normalizedUnit?: string;
  status: MetricRecordStatus;
  period?: string;
  // Present only for demographic metrics (follower_demographics,
  // engaged_audience_demographics, reached_audience_demographics), which
  // Meta returns broken down by one dimension per request.
  breakdown?: string;
  // Present only for metrics that require a relative reporting window
  // (e.g. demographics' this_month/this_week), distinct from `period`.
  timeframe?: string;
  sourceEndpoint: string;
  safeReasonCode?: string;
  // True only when the record's emptiness is explained by Meta's own
  // documented account-size threshold (e.g. under 100 followers for
  // demographics) rather than an error or a genuinely zero result —
  // never inferred, only set when Meta's response or a known, documented
  // threshold confirms it.
  unavailableDueToAccountSize?: boolean;
}

// Meta's account insights API has two distinct parameter shapes: most
// aggregate metrics (reach, views, likes, ...) take period + a concrete
// since/until date range; demographic metrics take period=lifetime + a
// relative `timeframe` (this_month/this_week) instead, and never accept
// since/until. A snapshot groups only metrics that share one shape, so
// it carries since/until OR timeframe, never a mix. `since`/`until` are
// always derived deterministically from `snapshotHour` (never live
// "now"), so two imports within the same UTC hour compute the identical
// value and correctly update the same document instead of creating a
// new one. `breakdown` is part of the row's identity alongside period/
// since/until/timeframe — profile_links_taps (contact_button_type) and
// follows_and_unfollows (follow_type) are both period=day with no
// timeframe, exactly like the plain aggregate group, and only the
// breakdown value keeps their rows distinct rather than colliding.
export interface AccountPerformanceSnapshot {
  schemaVersion: "1.0.0";
  accountPerformanceSnapshotId: string;
  connectionId: string;
  platform: Platform;
  accountType?: string;
  snapshotHour: string;
  collectedAt: string;
  period: string;
  since?: string;
  until?: string;
  timeframe?: string;
  breakdown?: string;
  completeness: DataCompleteness;
  metrics: AccountMetricRecord[];
  createdAt: string;
  updatedAt: string;
}
