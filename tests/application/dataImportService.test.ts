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

function buildEnvironment(nowValues?: string[]) {
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
  const importRunRepository = new InMemoryImportRunRepository();
  const settingsRepository = new InMemoryDataImportSettingsRepository();

  let nowIndex = 0;
  const now = nowValues
    ? () => nowValues[Math.min(nowIndex++, nowValues.length - 1)]!
    : () => new Date().toISOString();

  const dataImportService = new DataImportService({
    connectionService,
    importedContentRepository,
    performanceSnapshotRepository,
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
    const env = buildEnvironment([hourOne, hourOne, hourOne, hourOne, hourTwo, hourTwo, hourTwo, hourTwo]);
    await seedAllConnected(env);

    await env.dataImportService.runImport();
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
