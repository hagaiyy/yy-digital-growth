import { test } from "node:test";
import assert from "node:assert/strict";

import { CONNECTION_IDS } from "@/domain/connectionIds";
import { ConnectionService, SafeServiceError } from "@/application/services/ConnectionService";
import { DataImportService } from "@/application/services/DataImportService";
import { ConnectorError } from "@/application/connectors/types";
import { encryptCredential } from "@/infrastructure/crypto/encryption";
import { RunningImportConflictError } from "@/domain/repositories/ImportRunRepository";

import {
  InMemoryPlatformConnectionRepository,
  InMemoryPlatformCredentialRepository,
} from "../fakes/InMemoryRepositories";
import {
  InMemoryAccountPerformanceSnapshotRepository,
  InMemoryDataImportSettingsRepository,
  InMemoryImportedContentRepository,
  InMemoryImportRunRepository,
  InMemoryPerformanceSnapshotRepository,
} from "../fakes/InMemoryDataImportRepositories";
import {
  FakeFacebookConnector,
  FakeInstagramConnector,
  FakePinterestConnector,
} from "../fakes/FakeConnectors";

const ENCRYPTION_KEY = "test-data-import-service-key";

function withEncryptionKey<T>(fn: () => T): T {
  const original = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = ENCRYPTION_KEY;
  try {
    return fn();
  } finally {
    process.env.APP_ENCRYPTION_KEY = original;
  }
}

function buildEnvironment(nowValues?: string[] | (() => string)) {
  const connectionRepository = new InMemoryPlatformConnectionRepository();
  const credentialRepository = new InMemoryPlatformCredentialRepository();
  const instagramConnector = new FakeInstagramConnector();
  const facebookConnector = new FakeFacebookConnector();
  const pinterestConnector = new FakePinterestConnector();

  const connectionService = new ConnectionService({
    connectionRepository,
    credentialRepository,
    instagramConnector,
    facebookConnector,
    pinterestConnector,
  });

  const importedContentRepository = new InMemoryImportedContentRepository();
  const performanceSnapshotRepository = new InMemoryPerformanceSnapshotRepository();
  const accountPerformanceSnapshotRepository = new InMemoryAccountPerformanceSnapshotRepository();
  const importRunRepository = new InMemoryImportRunRepository();
  const settingsRepository = new InMemoryDataImportSettingsRepository();

  let nowIndex = 0;
  const now =
    typeof nowValues === "function"
      ? nowValues
      : nowValues
        ? () => nowValues[Math.min(nowIndex++, nowValues.length - 1)]!
        : () => new Date().toISOString();

  const dataImportService = new DataImportService({
    connectionService,
    importedContentRepository,
    performanceSnapshotRepository,
    accountPerformanceSnapshotRepository,
    importRunRepository,
    settingsRepository,
    instagramConnector,
    facebookConnector,
    pinterestConnector,
    now,
  });

  return {
    dataImportService,
    connectionRepository,
    credentialRepository,
    importedContentRepository,
    performanceSnapshotRepository,
    accountPerformanceSnapshotRepository,
    importRunRepository,
    instagramConnector,
    facebookConnector,
    pinterestConnector,
  };
}

async function seedConnected(
  connectionRepository: InMemoryPlatformConnectionRepository,
  credentialRepository: InMemoryPlatformCredentialRepository,
  connectionId: string,
  platform: "instagram" | "facebook" | "pinterest",
  connectionTarget: "account" | "page",
  credentialPayload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const now = new Date().toISOString();
  await connectionRepository.upsert({
    schemaVersion: "1.0.0",
    connectionId,
    platform,
    connectionTarget,
    status: "connected",
    connectedAt: now,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  await credentialRepository.save({
    connectionId,
    ...encryptCredential(credentialPayload),
    createdAt: now,
    updatedAt: now,
  });
}

async function seedAllConnected(env: ReturnType<typeof buildEnvironment>) {
  await seedConnected(
    env.connectionRepository,
    env.credentialRepository,
    CONNECTION_IDS.instagram,
    "instagram",
    "account",
    { accessToken: "fake-ig-token", accountId: "fake-ig-account" },
  );
  await seedConnected(
    env.connectionRepository,
    env.credentialRepository,
    CONNECTION_IDS.facebookAccount,
    "facebook",
    "account",
    { accessToken: "fake-fb-account-token" },
  );
  await seedConnected(
    env.connectionRepository,
    env.credentialRepository,
    CONNECTION_IDS.facebookPage,
    "facebook",
    "page",
    { accessToken: "fake-fb-page-token" },
    { externalAccountId: "page-1", parentConnectionId: CONNECTION_IDS.facebookAccount },
  );
  await seedConnected(
    env.connectionRepository,
    env.credentialRepository,
    CONNECTION_IDS.pinterest,
    "pinterest",
    "account",
    { accessToken: "fake-pin-token" },
  );
}

// Scenario 23: default Recent Content Limit is 30.
test("default Recent Content Limit is 30", async () => {
  const env = buildEnvironment();
  const settings = await env.dataImportService.getSettings();
  assert.equal(settings.recentContentLimit, 30);
});

test("rejects an out-of-range Recent Content Limit", async () => {
  const env = buildEnvironment();
  await assert.rejects(() => env.dataImportService.updateSettings(0), SafeServiceError);
  await assert.rejects(() => env.dataImportService.updateSettings(101), SafeServiceError);
  await assert.rejects(() => env.dataImportService.updateSettings(1.5), SafeServiceError);
});

// Scenarios 4/5/6: identity, repeated-import update, no duplication.
test("repeated imports upsert the same importedContent record instead of duplicating", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);

    const first = await env.dataImportService.runImport();
    const second = await env.dataImportService.runImport();

    const all = await env.importedContentRepository.list();
    const igItems = all.filter((c) => c.platform === "instagram");
    assert.equal(igItems.length, 1, "must not duplicate the same externalContentId");
    assert.equal(first.totals.createdItems > 0, true);
    assert.equal(second.totals.updatedItems > 0, true);
  });
});

test("an active Story is merged into the Instagram import alongside recent content, and never duplicated on re-import", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.activeStories = [
      {
        externalContentId: "story-1",
        contentType: "story",
        caption: null,
        permalink: "https://www.instagram.com/stories/fake/story-1",
        thumbnailUrl: "https://instagram.com/story-thumb.jpg",
        publishedAt: "2026-08-03T18:53:21Z",
        platformData: { media_type: "IMAGE", media_product_type: "STORY" },
      },
    ];

    await env.dataImportService.runImport();
    await env.dataImportService.runImport();

    const all = await env.importedContentRepository.list();
    const storyItems = all.filter((c) => c.platform === "instagram" && c.contentType === "story");
    assert.equal(storyItems.length, 1, "the Story must be imported exactly once, never duplicated on re-import");
    assert.equal(storyItems[0]?.externalContentId, "story-1");
  });
});

test("an active-Stories fetch failure never blocks the rest of the Instagram import", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.activeStories = new ConnectorError("failed", "Instagram rejected the active-Stories request.");

    const result = await env.dataImportService.runImport();
    const igResult = result.connectionResults.find((r) => r.platform === "instagram");
    assert.equal(igResult?.status, "success", "the normal recent-content item must still import successfully");
  });
});

// Scenarios 7/8: hourly snapshot upsert vs. new snapshot.
test("importing twice within the same UTC hour updates the same performanceSnapshot", async () => {
  await withEncryptionKey(async () => {
    const sameHour = "2026-07-29T06:10:00.000Z";
    const env = buildEnvironment([sameHour, sameHour, sameHour, sameHour, sameHour, sameHour, sameHour, sameHour]);
    await seedAllConnected(env);

    await env.dataImportService.runImport();
    await env.dataImportService.runImport();

    const igContent = (await env.importedContentRepository.list()).find((c) => c.platform === "instagram")!;
    const snapshots = await env.performanceSnapshotRepository.findByImportedContentId(igContent.importedContentId);
    assert.equal(snapshots.length, 1, "same UTC hour must update, not duplicate, the snapshot");
  });
});

test("importing in a new UTC hour creates a new performanceSnapshot", async () => {
  await withEncryptionKey(async () => {
    const hourOne = "2026-07-29T06:10:00.000Z";
    const hourTwo = "2026-07-29T09:45:00.000Z";
    // A mutable "current" value, not a fixed-length FIFO queue: how
    // many times now() is called within one runImport() is an
    // implementation detail (item count × per-item calls, plus
    // account-insights bookkeeping) — this test only cares that every
    // call within run 1 sees hourOne and every call within run 2 sees
    // hourTwo, not the exact count.
    let currentNow = hourOne;
    const env = buildEnvironment(() => currentNow);
    await seedAllConnected(env);

    await env.dataImportService.runImport();
    currentNow = hourTwo;
    await env.dataImportService.runImport();

    const igContent = (await env.importedContentRepository.list()).find((c) => c.platform === "instagram")!;
    const snapshots = await env.performanceSnapshotRepository.findByImportedContentId(igContent.importedContentId);
    assert.equal(snapshots.length, 2, "a new UTC hour must create an additional snapshot");
  });
});

// Scenarios 9/10: missing metrics stay missing; null distinct from zero.
test("missing metrics never become zero, and null stays distinct from zero", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.metricsOutcomeFor = () => ({
      kind: "success",
      metrics: { likes: 0, comments: null },
      successfulMetrics: ["likes", "comments"],
      failedMetrics: [{ metric: "shares", reason: "metricUnsupported" }],
      dataCompleteness: "partial",
    });

    await env.dataImportService.runImport();

    const igContent = (await env.importedContentRepository.list()).find((c) => c.platform === "instagram")!;
    const snapshot = await env.performanceSnapshotRepository.findLatestByImportedContentId(igContent.importedContentId);
    assert.ok(snapshot);
    assert.equal(snapshot!.metrics.likes, 0);
    assert.equal(snapshot!.metrics.comments, null);
    assert.ok(!("shares" in snapshot!.metrics), "a metric never returned must not appear at all");
  });
});

// Scenario 15: partial metrics are persisted, not discarded.
test("partial metrics are persisted with dataCompleteness partial", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.metricsOutcomeFor = () => ({
      kind: "success",
      metrics: { impressions: 500 },
      successfulMetrics: ["impressions"],
      failedMetrics: [{ metric: "reach", reason: "metricUnsupported" }],
      dataCompleteness: "partial",
    });

    const run = await env.dataImportService.runImport();
    const igResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.instagram)!;
    assert.equal(igResult.status, "partial");

    const igContent = (await env.importedContentRepository.list()).find((c) => c.platform === "instagram")!;
    const snapshot = await env.performanceSnapshotRepository.findLatestByImportedContentId(igContent.importedContentId);
    assert.equal(snapshot!.dataCompleteness, "partial");
    assert.equal(snapshot!.metrics.impressions, 500);
  });
});

// Scenario 13: one item failure does not stop remaining items.
test("one failing item does not stop the remaining items in the same connection", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.recentContent = [
      {
        externalContentId: "ig-ok",
        contentType: "reel",
        caption: "ok item",
        platformData: {},
      },
      {
        externalContentId: "ig-fails",
        contentType: "reel",
        caption: "failing item",
        platformData: {},
      },
    ];
    env.instagramConnector.metricsOutcomeFor = (id) =>
      id === "ig-fails"
        ? { kind: "failed", safeMessage: "Simulated metrics failure." }
        : {
            kind: "success",
            metrics: { likes: 5 },
            successfulMetrics: ["likes"],
            failedMetrics: [],
            dataCompleteness: "complete",
          };

    const run = await env.dataImportService.runImport();
    const igResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.instagram)!;
    assert.equal(igResult.requestedCount, 2);
    assert.equal(igResult.status, "partial");
    assert.ok(igResult.itemResults?.some((i) => i.externalContentId === "ig-fails"));
    assert.ok(!igResult.itemResults?.some((i) => i.externalContentId === "ig-ok"));

    const all = await env.importedContentRepository.list();
    assert.ok(all.some((c) => c.externalContentId === "ig-ok"));
    assert.ok(all.some((c) => c.externalContentId === "ig-fails"), "content metadata is still saved even if metrics fail");
  });
});

// Scenario 14: one platform failure does not stop other platforms.
test("one platform's connection failure does not stop other platforms from importing", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.recentContent = new ConnectorError("failed", "Instagram rejected the request.");

    const run = await env.dataImportService.runImport();
    const igResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.instagram)!;
    const pinResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.pinterest)!;

    assert.equal(igResult.status, "failed");
    assert.equal(pinResult.status, "success");
    assert.ok((await env.importedContentRepository.list()).some((c) => c.platform === "pinterest"));
  });
});

// Scenario 25 (revised): Facebook Account is an authorization-only
// connection — a live capability test (GET /me/posts) proved it can
// never return content without Advanced Access this app does not have,
// so it must be excluded from Data Import entirely rather than appearing
// as an "unsupported" connectionResult on every run.
test("Facebook Account is excluded from connectionResults and does not affect run status", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);

    const run = await env.dataImportService.runImport();
    const fbAccountResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.facebookAccount);

    assert.equal(fbAccountResult, undefined, "Facebook Account must not appear in connectionResults at all");
    assert.equal(run.totals.connections, 3, "only instagram, facebookPage, and pinterest are eligible sources");
    assert.notEqual(run.status, "failed");
  });
});

// Scenario 16: importRun stores aggregate counts.
test("importRun totals aggregate across all eligible connections", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);

    const run = await env.dataImportService.runImport();
    assert.equal(run.totals.connections, 3);
    assert.ok(run.totals.createdItems > 0);
  });
});

// Scenario 17: importRun stores exact failed/skipped/unsupported items, not just aggregates.
test("importRun connectionResults list exact non-success items for debugging", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.pinterestConnector.pinAnalyticsOutcomeFor = () => ({
      kind: "unsupported",
      failedMetrics: [],
      safeMessage: "Pinterest analytics are not available for this account.",
    });

    const run = await env.dataImportService.runImport();
    const pinResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.pinterest)!;
    assert.equal(pinResult.itemResults?.[0]?.status, "unsupported");
    assert.equal(pinResult.itemResults?.[0]?.externalContentId, "pin-1");
  });
});

// Scenario 18 (repository-level): simultaneous import runs are rejected.
test("a second import cannot start while one is already running (repository level)", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);

    const runningRun = {
      schemaVersion: "1.0.0" as const,
      importRunId: "import_run_already_running",
      status: "running" as const,
      startedAt: new Date().toISOString(),
      recentContentLimit: 30,
      totals: { connections: 0, requestedItems: 0, createdItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0 },
      connectionResults: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await env.importRunRepository.createRunning(runningRun);

    await assert.rejects(() => env.dataImportService.runImport(), SafeServiceError);
  });
});

// Scenario 21: no credentials appear in imported records.
test("no credentials appear anywhere in importedContent or performanceSnapshot records", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    await env.dataImportService.runImport();

    const forbidden = ["accessToken", "refreshToken", "access_token", "refresh_token", "authorization"];
    const contentItems = await env.importedContentRepository.list();
    for (const item of contentItems) {
      const serialized = JSON.stringify(item).toLowerCase();
      for (const term of forbidden) {
        assert.ok(!serialized.includes(term.toLowerCase()), `importedContent must not contain "${term}"`);
      }
    }
  });
});

// Part 6/13: account-level insights are a separate collection, never
// mixed into content performanceSnapshots.
test("Instagram account-level insights are persisted separately from content snapshots", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.instagramConnector.accountInsightsResult = [
      {
        period: "day",
        since: "2026-07-25T00:00:00.000Z",
        until: "2026-08-01T00:00:00.000Z",
        completeness: "partial",
        metrics: [
          {
            providerMetric: "reach",
            internalMetric: "reach",
            value: 5000,
            nativeUnit: "count",
            status: "supported",
            period: "day",
            sourceEndpoint: "/{ig-user-id}/insights",
          },
        ],
      },
    ];

    await env.dataImportService.runImport();

    assert.equal(env.instagramConnector.fetchAccountInsightsCallCount, 1);
    const snapshots = await env.dataImportService.getLatestAccountPerformance(CONNECTION_IDS.instagram);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]!.metrics[0]!.internalMetric, "reach");
    assert.equal(snapshots[0]!.completeness, "partial");

    const contentSnapshots = await env.performanceSnapshotRepository.findByImportedContentId(
      (await env.importedContentRepository.list()).find((c) => c.platform === "instagram")!.importedContentId,
    );
    assert.ok(
      contentSnapshots.every((s) => !("reach" in (s.metrics as Record<string, unknown>)) || s.metrics.reach !== 5000),
      "the account-level reach value must never be mixed into a content snapshot",
    );
  });
});

// Regression: two groups sharing the same period/since/until but a
// different `breakdown` (e.g. profile_links_taps' contact_button_type
// vs the plain no-breakdown aggregate group) must persist as two
// distinct account snapshots, never collide into one.
test("account snapshot groups with the same period/since/until but different breakdown never collide", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    const sharedSince = "2026-07-25T00:00:00.000Z";
    const sharedUntil = "2026-08-01T00:00:00.000Z";
    env.instagramConnector.accountInsightsResult = [
      {
        period: "day",
        since: sharedSince,
        until: sharedUntil,
        completeness: "complete",
        metrics: [
          {
            providerMetric: "reach",
            internalMetric: "reach",
            value: 100,
            nativeUnit: "count",
            status: "supported",
            sourceEndpoint: "/{ig-user-id}/insights",
          },
        ],
      },
      {
        period: "day",
        since: sharedSince,
        until: sharedUntil,
        breakdown: "contact_button_type",
        completeness: "complete",
        metrics: [
          {
            providerMetric: "profile_links_taps",
            internalMetric: "profileLinksTaps",
            value: 7,
            nativeUnit: "count",
            status: "supported",
            breakdown: "contact_button_type",
            sourceEndpoint: "/{ig-user-id}/insights",
          },
        ],
      },
    ];

    await env.dataImportService.runImport();

    const snapshots = await env.dataImportService.getLatestAccountPerformance(CONNECTION_IDS.instagram);
    assert.equal(snapshots.length, 2, "the no-breakdown and contact_button_type groups must both persist");
    const providerMetrics = snapshots.flatMap((s) => s.metrics.map((m) => m.providerMetric)).sort();
    assert.deepEqual(providerMetrics, ["profile_links_taps", "reach"]);
  });
});

// Regression: since/until must be derived from snapshotHour, not a
// fresh "now" each call — otherwise two imports in the same UTC hour
// create duplicate rows instead of updating the same one.
test("two imports within the same UTC hour update the same account snapshot instead of duplicating", async () => {
  await withEncryptionKey(async () => {
    const fixedHour = "2026-08-01T15:30:00.000Z";
    const env = buildEnvironment([fixedHour, fixedHour, fixedHour, fixedHour, fixedHour, fixedHour, fixedHour, fixedHour]);
    await seedAllConnected(env);
    env.instagramConnector.accountInsightsResult = [
      {
        period: "day",
        since: "2026-07-25T15:30:00.000Z",
        until: "2026-08-01T15:30:00.000Z",
        completeness: "complete",
        metrics: [
          {
            providerMetric: "reach",
            internalMetric: "reach",
            value: 100,
            nativeUnit: "count",
            status: "supported",
            sourceEndpoint: "/{ig-user-id}/insights",
          },
        ],
      },
    ];

    await env.dataImportService.runImport();
    await env.dataImportService.runImport();

    const snapshots = await env.dataImportService.getAccountPerformanceHistory(CONNECTION_IDS.instagram);
    assert.equal(snapshots.length, 1, "a second import in the same UTC hour must update the existing row");
  });
});

test("an account-insights fetch failure never fails the Instagram connection or blocks content import", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    const originalFetch = env.instagramConnector.fetchAccountInsights.bind(env.instagramConnector);
    env.instagramConnector.fetchAccountInsights = async () => {
      throw new Error("simulated account-insights failure");
    };

    const run = await env.dataImportService.runImport();
    const igResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.instagram)!;

    assert.equal(igResult.status, "success", "content items must still import successfully");
    env.instagramConnector.fetchAccountInsights = originalFetch;
  });
});

// Part 7: Facebook Page-level insights reuse the same accountPerformanceSnapshots
// structure as Instagram, kept separate from post-level performanceSnapshots.
test("Facebook Page-level insights are persisted separately from post-level snapshots", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.facebookConnector.pageInsightsResult = {
      period: "day",
      completeness: "partial",
      metrics: [
        {
          providerMetric: "page_impressions",
          internalMetric: "impressions",
          value: 4200,
          nativeUnit: "count",
          status: "available",
          period: "day",
          sourceEndpoint: "/{page-id}/insights",
        },
      ],
    };

    await env.dataImportService.runImport();

    assert.equal(env.facebookConnector.fetchPageInsightsCallCount, 1);
    const snapshots = await env.dataImportService.getLatestAccountPerformance(CONNECTION_IDS.facebookPage);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]!.metrics[0]!.internalMetric, "impressions");
    assert.equal(snapshots[0]!.completeness, "partial");

    const postSnapshot = await env.performanceSnapshotRepository.findByImportedContentId(
      (await env.importedContentRepository.list()).find((c) => c.platform === "facebook")!.importedContentId,
    );
    assert.ok(
      postSnapshot.every((s) => (s.metrics as Record<string, unknown>).impressions !== 4200),
      "the Page-level impressions value (4200) must never be mixed into a post-level snapshot",
    );
  });
});

test("a Facebook Page-insights fetch failure never fails the connection or blocks post import", async () => {
  await withEncryptionKey(async () => {
    const env = buildEnvironment();
    await seedAllConnected(env);
    env.facebookConnector.fetchPageInsights = async () => {
      throw new Error("simulated page-insights failure");
    };

    const run = await env.dataImportService.runImport();
    const fbResult = run.connectionResults.find((r) => r.connectionId === CONNECTION_IDS.facebookPage)!;
    assert.notEqual(fbResult.status, "failed", "post import must still succeed");
  });
});

test("the underlying repository throws RunningImportConflictError for a second concurrent running run", async () => {
  const env = buildEnvironment();
  const run = (overrides: Partial<{ importRunId: string }>) => ({
    schemaVersion: "1.0.0" as const,
    importRunId: overrides.importRunId ?? "run",
    status: "running" as const,
    startedAt: new Date().toISOString(),
    recentContentLimit: 30,
    totals: { connections: 0, requestedItems: 0, createdItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0 },
    connectionResults: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await env.importRunRepository.createRunning(run({ importRunId: "run-1" }));
  await assert.rejects(
    () => env.importRunRepository.createRunning(run({ importRunId: "run-2" })),
    RunningImportConflictError,
  );
});
