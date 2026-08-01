import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAccountPerformanceSnapshot, ValidationError } from "@/application/validation/validators";

const valid = {
  schemaVersion: "1.0.0",
  accountPerformanceSnapshotId: "account_performance_snapshot_internal_id",
  connectionId: "connection_instagram_primary",
  platform: "instagram",
  accountType: "creator",
  snapshotHour: "2026-08-01T13:00:00Z",
  collectedAt: "2026-08-01T13:31:00Z",
  period: "day",
  since: "2026-07-25",
  until: "2026-08-01",
  completeness: "partial",
  metrics: [
    {
      providerMetric: "reach",
      internalMetric: "reach",
      value: 1200,
      nativeUnit: "count",
      status: "supported",
      period: "day",
      sourceEndpoint: "/insights",
    },
    {
      providerMetric: "website_clicks",
      internalMetric: "websiteClicks",
      value: null,
      nativeUnit: "count",
      status: "deprecated",
      sourceEndpoint: "/insights",
      safeReasonCode: "metricDeprecated",
    },
  ],
  createdAt: "2026-08-01T13:31:00Z",
  updatedAt: "2026-08-01T13:31:00Z",
};

test("accepts a valid accountPerformanceSnapshot record", () => {
  const result = validateAccountPerformanceSnapshot(valid);
  assert.equal(result.period, "day");
  assert.equal(result.metrics.length, 2);
});

test("accepts a demographic-style record with breakdown/timeframe instead of since/until", () => {
  const { since: _since, until: _until, ...withoutRange } = valid;
  const result = validateAccountPerformanceSnapshot({
    ...withoutRange,
    period: "lifetime",
    timeframe: "this_month",
    metrics: [
      {
        providerMetric: "follower_demographics",
        internalMetric: "followerDemographicsByAge",
        value: null,
        nativeUnit: "percentage",
        status: "empty",
        breakdown: "age",
        timeframe: "this_month",
        sourceEndpoint: "/insights",
        unavailableDueToAccountSize: true,
      },
    ],
  });
  assert.equal(result.timeframe, "this_month");
  assert.equal(result.metrics[0]!.unavailableDueToAccountSize, true);
});

test("never collapses an account-size-limited demographic result into zero", () => {
  const result = validateAccountPerformanceSnapshot({
    ...valid,
    metrics: [
      {
        providerMetric: "follower_demographics",
        internalMetric: "followerDemographicsByGender",
        value: null,
        nativeUnit: "percentage",
        status: "empty",
        breakdown: "gender",
        sourceEndpoint: "/insights",
        unavailableDueToAccountSize: true,
      },
    ],
  });
  assert.equal(result.metrics[0]!.value, null);
});

test("rejects an invalid completeness value", () => {
  assert.throws(
    () => validateAccountPerformanceSnapshot({ ...valid, completeness: "estimated" }),
    ValidationError,
  );
});

test("rejects an invalid metric record status", () => {
  assert.throws(
    () =>
      validateAccountPerformanceSnapshot({
        ...valid,
        metrics: [{ ...valid.metrics[0], status: "maybeSupported" }],
      }),
    ValidationError,
  );
});

test("rejects a record missing a required field", () => {
  const { collectedAt: _omit, ...withoutCollectedAt } = valid;
  assert.throws(() => validateAccountPerformanceSnapshot(withoutCollectedAt), ValidationError);
});

test("rejects an unstructured metrics object instead of an array of records", () => {
  assert.throws(
    () => validateAccountPerformanceSnapshot({ ...valid, metrics: { reach: 1200 } }),
    ValidationError,
  );
});
