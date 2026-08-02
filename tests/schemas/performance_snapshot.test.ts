import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePerformanceSnapshot, ValidationError } from "@/application/validation/validators";

const valid = {
  schemaVersion: "1.0.0",
  performanceSnapshotId: "snapshot_internal_id",
  importedContentId: "imported_content_internal_id",
  connectionId: "connection_instagram_primary",
  platform: "instagram",
  snapshotHour: "2026-07-29T06:00:00Z",
  collectedAt: "2026-07-29T06:22:00Z",
  metrics: {
    views: 1782,
    reach: 1507,
    likes: 48,
    comments: 1,
    shares: 3,
    saves: 6,
    averageWatchTimeMs: 14826,
    skipRate: 37.2,
  },
  dataCompleteness: "partial",
  createdAt: "2026-07-29T06:05:00Z",
  updatedAt: "2026-07-29T06:22:00Z",
};

test("accepts a valid performanceSnapshot record", () => {
  const result = validatePerformanceSnapshot(valid);
  assert.equal(result.snapshotHour, "2026-07-29T06:00:00Z");
});

test("accepts null and zero within metrics without collapsing them", () => {
  const result = validatePerformanceSnapshot({
    ...valid,
    metrics: { likes: 0, comments: null },
  });
  assert.equal(result.metrics.likes, 0);
  assert.equal(result.metrics.comments, null);
  assert.ok(!("shares" in result.metrics));
});

test("accepts an empty metrics object for dataCompleteness unavailable", () => {
  const result = validatePerformanceSnapshot({ ...valid, metrics: {}, dataCompleteness: "unavailable" });
  assert.deepEqual(result.metrics, {});
});

test("rejects an invalid dataCompleteness value", () => {
  assert.throws(
    () => validatePerformanceSnapshot({ ...valid, dataCompleteness: "estimated" }),
    ValidationError,
  );
});

test("rejects an invalid platform value", () => {
  assert.throws(() => validatePerformanceSnapshot({ ...valid, platform: "tiktok" }), ValidationError);
});

test("rejects a record missing a required field", () => {
  const { collectedAt: _omit, ...withoutCollectedAt } = valid;
  assert.throws(() => validatePerformanceSnapshot(withoutCollectedAt), ValidationError);
});

test("accepts the additive Instagram-only fields alongside the flat metrics object", () => {
  const result = validatePerformanceSnapshot({
    ...valid,
    accountType: "creator",
    contentType: "reel",
    providerMediaType: "VIDEO",
    providerMediaProductType: "REELS",
    metricRecords: [
      {
        providerMetric: "ig_reels_avg_watch_time",
        internalMetric: "averageWatchTimeMs",
        value: 14850,
        nativeUnit: "milliseconds",
        status: "supported",
        sourceEndpoint: "/insights",
      },
      {
        providerMetric: "impressions",
        internalMetric: "impressions",
        value: null,
        nativeUnit: "count",
        status: "deprecated",
        sourceEndpoint: "/insights",
        safeReasonCode: "metricDeprecated",
      },
    ],
  });
  assert.equal(result.contentType, "reel");
  assert.equal(result.metricRecords?.length, 2);
});

test("accepts dataCompleteness untested for a content type with no live capability test", () => {
  const result = validatePerformanceSnapshot({ ...valid, metrics: {}, dataCompleteness: "untested" });
  assert.equal(result.dataCompleteness, "untested");
});

test("a record without the additive Instagram-only fields still validates (Facebook/Pinterest compatibility)", () => {
  const result = validatePerformanceSnapshot(valid);
  assert.equal(result.metricRecords, undefined);
  assert.equal(result.contentType, undefined);
});

test("accepts the contextual distribution-eligibility statuses and safeReasonMessage", () => {
  const result = validatePerformanceSnapshot({
    ...valid,
    contentType: "reel",
    metricRecords: [
      {
        providerMetric: "plays",
        internalMetric: "plays",
        value: null,
        nativeUnit: "count",
        status: "deprecated",
        sourceEndpoint: "/insights",
        safeReasonMessage: "Not returned for this media — views is available instead.",
      },
      {
        providerMetric: "facebook_views",
        internalMetric: "facebookViews",
        value: null,
        nativeUnit: "count",
        status: "noFacebookDistribution",
        sourceEndpoint: "/insights",
        safeReasonMessage: "No Facebook distribution for this media.",
      },
      {
        providerMetric: "crossposted_views",
        internalMetric: "crosspostedViews",
        value: null,
        nativeUnit: "count",
        status: "notCrossposted",
        sourceEndpoint: "/insights",
        safeReasonMessage: "This item was not crossposted to Facebook.",
      },
    ],
  });
  assert.equal(result.metricRecords?.length, 3);
  assert.equal(result.metricRecords?.[1]?.status, "noFacebookDistribution");
});

test("rejects an invalid metric record status", () => {
  assert.throws(
    () =>
      validatePerformanceSnapshot({
        ...valid,
        metricRecords: [
          {
            providerMetric: "plays",
            internalMetric: "plays",
            value: null,
            nativeUnit: "count",
            status: "notARealStatus",
            sourceEndpoint: "/insights",
          },
        ],
      }),
    ValidationError,
  );
});
