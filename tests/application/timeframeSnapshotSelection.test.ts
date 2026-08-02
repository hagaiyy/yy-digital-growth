import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectAllTimeframeSnapshots,
  selectTimeframeSnapshot,
} from "@/application/performance/timeframeSnapshotSelection";
import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";

function snapshot(collectedAt: string): PerformanceSnapshot {
  return {
    schemaVersion: "1.0.0",
    performanceSnapshotId: `performance_snapshot_${collectedAt}`,
    importedContentId: "imported_content_test",
    connectionId: "connection_test",
    platform: "facebook",
    snapshotHour: collectedAt,
    collectedAt,
    metrics: {},
    dataCompleteness: "complete",
    createdAt: collectedAt,
    updatedAt: collectedAt,
  };
}

const PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

test("latest always picks the greatest collectedAt regardless of publish date", () => {
  const snapshots = [
    snapshot("2026-01-01T02:00:00.000Z"),
    snapshot("2026-01-05T00:00:00.000Z"),
    snapshot("2026-01-03T00:00:00.000Z"),
  ];
  const result = selectTimeframeSnapshot(snapshots, PUBLISHED_AT, "latest");
  assert.equal(result?.collectedAt, "2026-01-05T00:00:00.000Z");
});

test("first4Hours picks the latest snapshot still inside the 4-hour window", () => {
  const snapshots = [
    snapshot("2026-01-01T01:00:00.000Z"), // inside
    snapshot("2026-01-01T03:59:00.000Z"), // inside, later
    snapshot("2026-01-01T05:00:00.000Z"), // outside (after window)
  ];
  const result = selectTimeframeSnapshot(snapshots, PUBLISHED_AT, "first4Hours");
  assert.equal(result?.collectedAt, "2026-01-01T03:59:00.000Z");
});

test("firstDay excludes snapshots collected before publish", () => {
  const snapshots = [
    snapshot("2025-12-31T23:00:00.000Z"), // before publish — excluded
    snapshot("2026-01-01T12:00:00.000Z"), // inside
  ];
  const result = selectTimeframeSnapshot(snapshots, PUBLISHED_AT, "firstDay");
  assert.equal(result?.collectedAt, "2026-01-01T12:00:00.000Z");
});

test("firstWeek returns null when no snapshot falls inside the window", () => {
  const snapshots = [snapshot("2026-01-10T00:00:00.000Z")]; // 9 days later, outside the 7-day window
  const result = selectTimeframeSnapshot(snapshots, PUBLISHED_AT, "firstWeek");
  assert.equal(result, null);
});

test("returns null (never interpolates) when there are no snapshots at all", () => {
  assert.equal(selectTimeframeSnapshot([], PUBLISHED_AT, "first4Hours"), null);
  assert.equal(selectTimeframeSnapshot([], PUBLISHED_AT, "latest"), null);
});

test("returns null for windowed timeframes when publishedAt is missing", () => {
  const snapshots = [snapshot("2026-01-01T01:00:00.000Z")];
  assert.equal(selectTimeframeSnapshot(snapshots, null, "first4Hours"), null);
  assert.equal(selectTimeframeSnapshot(snapshots, undefined, "firstDay"), null);
});

test("latest still resolves even when publishedAt is missing", () => {
  const snapshots = [snapshot("2026-01-01T01:00:00.000Z")];
  const result = selectTimeframeSnapshot(snapshots, null, "latest");
  assert.equal(result?.collectedAt, "2026-01-01T01:00:00.000Z");
});

test("window boundaries are inclusive at both ends", () => {
  const exactlyAtPublish = snapshot(PUBLISHED_AT);
  const exactlyAtWindowEnd = snapshot("2026-01-01T04:00:00.000Z"); // publish + 4h exactly
  assert.equal(selectTimeframeSnapshot([exactlyAtPublish], PUBLISHED_AT, "first4Hours")?.collectedAt, PUBLISHED_AT);
  assert.equal(
    selectTimeframeSnapshot([exactlyAtWindowEnd], PUBLISHED_AT, "first4Hours")?.collectedAt,
    "2026-01-01T04:00:00.000Z",
  );
});

test("selectAllTimeframeSnapshots computes all four independently", () => {
  const snapshots = [
    snapshot("2026-01-01T02:00:00.000Z"), // within first4Hours
    snapshot("2026-01-01T12:00:00.000Z"), // within firstDay (not first4Hours)
    snapshot("2026-01-04T00:00:00.000Z"), // within firstWeek only
    snapshot("2026-01-20T00:00:00.000Z"), // outside all windows, but is the latest overall
  ];
  const result = selectAllTimeframeSnapshots(snapshots, PUBLISHED_AT);
  assert.equal(result.first4Hours?.collectedAt, "2026-01-01T02:00:00.000Z");
  assert.equal(result.firstDay?.collectedAt, "2026-01-01T12:00:00.000Z");
  assert.equal(result.firstWeek?.collectedAt, "2026-01-04T00:00:00.000Z");
  assert.equal(result.latest?.collectedAt, "2026-01-20T00:00:00.000Z");
});
