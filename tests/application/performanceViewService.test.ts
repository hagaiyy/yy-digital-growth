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
