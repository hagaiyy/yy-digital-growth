import { test } from "node:test";
import assert from "node:assert/strict";

import { PerformanceViewService } from "@/application/services/PerformanceViewService";
import type { MetricRecord } from "@/domain/models/PerformanceSnapshot";

import {
  InMemoryImportedContentRepository,
  InMemoryMetricVisibilityPreferenceRepository,
  InMemoryPerformanceSnapshotRepository,
} from "../fakes/InMemoryDataImportRepositories";

const PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

function buildService() {
  const importedContentRepository = new InMemoryImportedContentRepository();
  const performanceSnapshotRepository = new InMemoryPerformanceSnapshotRepository();
  const metricVisibilityPreferenceRepository = new InMemoryMetricVisibilityPreferenceRepository();
  const service = new PerformanceViewService({
    importedContentRepository,
    performanceSnapshotRepository,
    metricVisibilityPreferenceRepository,
  });
  return { service, importedContentRepository, performanceSnapshotRepository };
}

async function seedContent(
  repo: InMemoryImportedContentRepository,
  overrides: Partial<Parameters<InMemoryImportedContentRepository["upsertByIdentity"]>[0]> = {},
) {
  const { record } = await repo.upsertByIdentity({
    schemaVersion: "1.0.0",
    connectionId: "connection_facebook_page_primary",
    platform: "facebook",
    externalContentId: `ext_${Math.random()}`,
    contentType: "imagePost",
    status: "active",
    title: null,
    caption: "hello world",
    hashtags: [],
    permalink: null,
    thumbnailUrl: null,
    publishedAt: PUBLISHED_AT,
    platformData: {},
    ...overrides,
  });
  return record;
}

test("listTabs groups imported content by platform+contentType and skips empty combos", async () => {
  const { service, importedContentRepository } = buildService();
  await seedContent(importedContentRepository, { contentType: "imagePost" });
  await seedContent(importedContentRepository, { contentType: "imagePost" });
  await seedContent(importedContentRepository, { contentType: "linkPost" });

  const tabs = await service.listTabs();
  assert.deepEqual(
    tabs.map((t) => ({ platform: t.platform, contentType: t.contentType, itemCount: t.itemCount })),
    [
      { platform: "facebook", contentType: "imagePost", itemCount: 2 },
      { platform: "facebook", contentType: "linkPost", itemCount: 1 },
    ],
  );
  assert.equal(tabs[0]?.label, "Facebook — Image Posts");
  // Reel content never appeared, so no Reel tab exists at all.
  assert.ok(!tabs.some((t) => t.contentType === "reel"));
});

test("getTable never displays a metric irrelevant to the content type", async () => {
  const { service, importedContentRepository, performanceSnapshotRepository } = buildService();
  const content = await seedContent(importedContentRepository, { contentType: "imagePost" });
  await performanceSnapshotRepository.upsertByHour({
    schemaVersion: "1.0.0",
    importedContentId: content.importedContentId,
    connectionId: content.connectionId,
    platform: "facebook",
    snapshotHour: "2026-01-01T00:00:00.000Z",
    collectedAt: "2026-01-01T00:30:00.000Z",
    metrics: { likes: 3 },
    dataCompleteness: "partial",
    metricRecords: [
      { providerMetric: "likes.summary(true)", internalMetric: "likes", value: 3, nativeUnit: "count", status: "available", sourceEndpoint: "/{post-id}" },
    ] satisfies MetricRecord[],
  });

  const table = await service.getTable("facebook", "imagePost");
  assert.ok(!table.relevantMetrics.some((m) => m.internalMetric === "videoViews"), "video-only metric must not appear for imagePost");
  assert.ok(table.relevantMetrics.some((m) => m.internalMetric === "likes"));
});

test("getTable reports 'no snapshot' for a timeframe with nothing collected in that window, without fabricating zero", async () => {
  const { service, importedContentRepository, performanceSnapshotRepository } = buildService();
  const content = await seedContent(importedContentRepository, { contentType: "imagePost", publishedAt: PUBLISHED_AT });
  // Only one snapshot, collected 2 days after publish — inside firstWeek and latest, outside first4Hours/firstDay.
  await performanceSnapshotRepository.upsertByHour({
    schemaVersion: "1.0.0",
    importedContentId: content.importedContentId,
    connectionId: content.connectionId,
    platform: "facebook",
    snapshotHour: "2026-01-03T00:00:00.000Z",
    collectedAt: "2026-01-03T00:00:00.000Z",
    metrics: { likes: 5 },
    dataCompleteness: "complete",
    metricRecords: [
      { providerMetric: "likes.summary(true)", internalMetric: "likes", value: 5, nativeUnit: "count", status: "available", sourceEndpoint: "/{post-id}" },
    ] satisfies MetricRecord[],
  });

  const table = await service.getTable("facebook", "imagePost");
  const row = table.rows[0]!;
  assert.equal(row.timeframes.first4Hours.hasSnapshot, false);
  assert.equal(row.timeframes.firstDay.hasSnapshot, false);
  assert.equal(row.timeframes.firstWeek.hasSnapshot, true);
  assert.equal(row.timeframes.latest.hasSnapshot, true);
  const likesCell = row.timeframes.firstWeek.metrics.find((m) => m.internalMetric === "likes");
  assert.equal(likesCell?.value, 5);
  assert.equal(likesCell?.status, "available");
});

test("getTable falls back to the registry's canonical status when a snapshot never attempted a relevant metric", async () => {
  const { service, importedContentRepository, performanceSnapshotRepository } = buildService();
  const content = await seedContent(importedContentRepository, { contentType: "imagePost" });
  await performanceSnapshotRepository.upsertByHour({
    schemaVersion: "1.0.0",
    importedContentId: content.importedContentId,
    connectionId: content.connectionId,
    platform: "facebook",
    snapshotHour: "2026-01-01T00:00:00.000Z",
    collectedAt: "2026-01-01T00:30:00.000Z",
    metrics: {},
    dataCompleteness: "partial",
    // No metricRecords at all for this snapshot.
  });

  const table = await service.getTable("facebook", "imagePost");
  const row = table.rows[0]!;
  const sharesCell = row.timeframes.latest.metrics.find((m) => m.internalMetric === "shares");
  // "shares" is registered as canonically "empty" for Facebook imagePost.
  assert.equal(sharesCell?.status, "empty");
  assert.equal(sharesCell?.value, null);
});

test("setHiddenMetrics persists and getHiddenMetrics reads it back, independent per platform+contentType", async () => {
  const { service } = buildService();
  await service.setHiddenMetrics("facebook", "imagePost", ["shares", "views"]);
  assert.deepEqual(await service.getHiddenMetrics("facebook", "imagePost"), ["shares", "views"]);
  assert.deepEqual(await service.getHiddenMetrics("facebook", "linkPost"), []);
});

test("listTabs merges imageStory and videoStory into one 'Instagram — Stories' tab", async () => {
  const { service, importedContentRepository } = buildService();
  await seedContent(importedContentRepository, { platform: "instagram", contentType: "imageStory", externalContentId: "img-story-1" });
  await seedContent(importedContentRepository, { platform: "instagram", contentType: "videoStory", externalContentId: "vid-story-1" });

  const tabs = await service.listTabs();
  const storyTabs = tabs.filter((t) => t.platform === "instagram" && t.contentType === "story");
  assert.equal(storyTabs.length, 1, "imageStory and videoStory must merge into exactly one tab, not two");
  assert.equal(storyTabs[0]?.itemCount, 2, "the merged tab counts both sub-types");
  assert.equal(storyTabs[0]?.label, "Instagram — Stories");
});

test("getTable('instagram','story') returns both imageStory and videoStory rows, each using its OWN content type's relevant metrics", async () => {
  const { service, importedContentRepository, performanceSnapshotRepository } = buildService();
  const imageStory = await seedContent(importedContentRepository, {
    platform: "instagram",
    contentType: "imageStory",
    externalContentId: "img-story-1",
    publishedAt: PUBLISHED_AT,
  });
  const videoStory = await seedContent(importedContentRepository, {
    platform: "instagram",
    contentType: "videoStory",
    externalContentId: "vid-story-1",
    publishedAt: PUBLISHED_AT,
  });
  await performanceSnapshotRepository.upsertByHour({
    schemaVersion: "1.0.0",
    importedContentId: imageStory.importedContentId,
    connectionId: imageStory.connectionId,
    platform: "instagram",
    snapshotHour: PUBLISHED_AT,
    collectedAt: PUBLISHED_AT,
    metrics: { views: 26 },
    dataCompleteness: "complete",
    metricRecords: [
      { providerMetric: "views", internalMetric: "views", value: 26, nativeUnit: "count", status: "available", sourceEndpoint: "/{media-id}/insights" },
    ] satisfies MetricRecord[],
  });
  await performanceSnapshotRepository.upsertByHour({
    schemaVersion: "1.0.0",
    importedContentId: videoStory.importedContentId,
    connectionId: videoStory.connectionId,
    platform: "instagram",
    snapshotHour: PUBLISHED_AT,
    collectedAt: PUBLISHED_AT,
    metrics: { views: 9 },
    dataCompleteness: "complete",
    metricRecords: [
      { providerMetric: "views", internalMetric: "views", value: 9, nativeUnit: "count", status: "available", sourceEndpoint: "/{media-id}/insights" },
    ] satisfies MetricRecord[],
  });

  const table = await service.getTable("instagram", "story");
  assert.equal(table.rows.length, 2, "both Story sub-types must appear together in the merged table");

  const imageRow = table.rows.find((r) => r.importedContentId === imageStory.importedContentId)!;
  const videoRow = table.rows.find((r) => r.importedContentId === videoStory.importedContentId)!;
  assert.equal(imageRow.contentType, "imageStory");
  assert.equal(videoRow.contentType, "videoStory");

  // Same provider metric ("views") reported with each row's OWN
  // content type's real evidence — imageStory's proven "available"
  // must never leak onto videoStory's own record (here also available
  // from its own real record), proving per-row independence.
  const imageViews = imageRow.timeframes.latest.metrics.find((m) => m.internalMetric === "views");
  const videoViews = videoRow.timeframes.latest.metrics.find((m) => m.internalMetric === "views");
  assert.equal(imageViews?.value, 26);
  assert.equal(videoViews?.value, 9);

  // A metric imageStory has *proven* invalid (reposts) must fall back
  // to videoStory's own still-"untested" status on the video row, never
  // to imageStory's invalidForApiModel verdict.
  const videoReposts = videoRow.timeframes.latest.metrics.find((m) => m.internalMetric === "reposts");
  assert.equal(videoReposts?.status, "untested");
  const imageReposts = imageRow.timeframes.latest.metrics.find((m) => m.internalMetric === "reposts");
  assert.equal(imageReposts?.status, "invalidForApiModel");
});

test("getTable('instagram','story') hidden-metrics preference is shared across the merged tab (keyed by the group, not the sub-type)", async () => {
  const { service } = buildService();
  await service.setHiddenMetrics("instagram", "story", ["reposts"]);
  assert.deepEqual(await service.getHiddenMetrics("instagram", "story"), ["reposts"]);
  // Sub-types themselves have no independent preference record — the
  // whole tab shares one, matching what the user actually interacts with.
  assert.deepEqual(await service.getHiddenMetrics("instagram", "imageStory"), []);
});
