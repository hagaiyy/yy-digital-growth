import { test } from "node:test";
import assert from "node:assert/strict";

import { connectForTests } from "@/infrastructure/mongodb/client";
import { ensureIndexes } from "@/infrastructure/mongodb/collections";
import { MongoPlatformConnectionRepository } from "@/infrastructure/mongodb/repositories/MongoPlatformConnectionRepository";
import { MongoPlatformCredentialRepository } from "@/infrastructure/mongodb/repositories/MongoPlatformCredentialRepository";
import { MongoImportedContentRepository } from "@/infrastructure/mongodb/repositories/MongoImportedContentRepository";
import { MongoPerformanceSnapshotRepository } from "@/infrastructure/mongodb/repositories/MongoPerformanceSnapshotRepository";
import { MongoImportRunRepository } from "@/infrastructure/mongodb/repositories/MongoImportRunRepository";
import { MongoDataImportSettingsRepository } from "@/infrastructure/mongodb/repositories/MongoDataImportSettingsRepository";
import { RunningImportConflictError } from "@/domain/repositories/ImportRunRepository";
import { ConnectionService } from "@/application/services/ConnectionService";
import { DataImportService } from "@/application/services/DataImportService";
import { generateOAuthState } from "@/interfaces/http/oauthState";
import { FakeInstagramConnector, FakeFacebookConnector, FakePinterestConnector } from "../fakes/FakeConnectors";

const TEST_URI = process.env.MONGODB_TEST_URI;
const TEST_DATABASE = "yy_digital_growth_test";
const skip = TEST_URI ? false : "MONGODB_TEST_URI is not set; skipping MongoDB integration tests";

test("platformConnection reads never expose MongoDB _id", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const repo = new MongoPlatformConnectionRepository(db);
    const connectionId = `connection_integration_test_${Date.now()}`;
    const record = {
      schemaVersion: "1.0.0" as const,
      connectionId,
      platform: "instagram" as const,
      connectionTarget: "account" as const,
      status: "connected" as const,
      externalAccountId: "ext-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.upsert(record);

    const found = await repo.findByConnectionId(connectionId);
    assert.ok(found);
    assert.ok(!("_id" in (found as object)));

    const listed = await repo.list();
    assert.ok(listed.every((c) => !("_id" in (c as object))));

    await db.collection("platformConnections").deleteOne({ connectionId });
  } finally {
    await client.close();
  }
});

// Scenario 17: even with a private credential stored under the same
// connectionId, the public connection read path never surfaces it.
test("private credentials are never returned alongside public connection records", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const connectionRepo = new MongoPlatformConnectionRepository(db);
    const credentialRepo = new MongoPlatformCredentialRepository(db);
    const connectionId = `connection_integration_credential_test_${Date.now()}`;

    await connectionRepo.upsert({
      schemaVersion: "1.0.0",
      connectionId,
      platform: "pinterest",
      connectionTarget: "account",
      status: "connected",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await credentialRepo.save({
      connectionId,
      algorithm: "aes-256-gcm",
      iv: "fake-iv",
      authTag: "fake-auth-tag",
      ciphertext: "fake-ciphertext-value",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const found = await connectionRepo.findByConnectionId(connectionId);
    const serialized = JSON.stringify(found);
    assert.ok(!serialized.includes("fake-ciphertext-value"));
    assert.ok(!("ciphertext" in (found as object)));
    assert.ok(!("iv" in (found as object)));
    assert.ok(!("authTag" in (found as object)));

    await db.collection("platformConnections").deleteOne({ connectionId });
    await db.collection("platformCredentials").deleteOne({ connectionId });
  } finally {
    await client.close();
  }
});

// Scenario 21: persisted connections survive a server restart, simulated
// here by closing the first MongoClient entirely and opening a brand new
// one — nothing survives in memory between them, only what is in MongoDB.
test("connections persisted before a restart are readable after a fresh connection", { skip }, async () => {
  const first = await connectForTests(TEST_URI!, TEST_DATABASE);
  const connectionId = `connection_integration_restart_test_${Date.now()}`;
  try {
    await ensureIndexes(first.db);
    const repoBeforeRestart = new MongoPlatformConnectionRepository(first.db);
    await repoBeforeRestart.upsert({
      schemaVersion: "1.0.0",
      connectionId,
      platform: "instagram",
      connectionTarget: "account",
      status: "connected",
      externalAccountId: "restart-test-account",
      lastVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } finally {
    await first.client.close();
  }

  const second = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    const repoAfterRestart = new MongoPlatformConnectionRepository(second.db);
    const found = await repoAfterRestart.findByConnectionId(connectionId);
    assert.ok(found);
    assert.equal(found!.status, "connected");
    assert.equal(found!.externalAccountId, "restart-test-account");

    await second.db.collection("platformConnections").deleteOne({ connectionId });
  } finally {
    await second.client.close();
  }
});

test("ConnectionService reads real persisted state without forcing reconnection", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const connectionRepository = new MongoPlatformConnectionRepository(db);
    const credentialRepository = new MongoPlatformCredentialRepository(db);
    const instagramConnector = new FakeInstagramConnector();

    const service = new ConnectionService({
      connectionRepository,
      credentialRepository,
      instagramConnector,
      facebookConnector: new FakeFacebookConnector(),
      pinterestConnector: new FakePinterestConnector(),
    });

    const originalKey = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = "integration-test-key";
    try {
      await service.handleInstagramCallback(
        "code",
        generateOAuthState("instagram", process.env.APP_ENCRYPTION_KEY!),
      );
      instagramConnector.fetchConnectedInstagramAccountCallCount = 0;

      const connections = await service.list();
      const instagram = connections.find((c) => c.platform === "instagram");
      assert.equal(instagram?.status, "connected");
      assert.equal(instagramConnector.fetchConnectedInstagramAccountCallCount, 0);
    } finally {
      process.env.APP_ENCRYPTION_KEY = originalKey;
    }

    await db.collection("platformConnections").deleteMany({ platform: "instagram" });
    await db.collection("platformCredentials").deleteMany({});
  } finally {
    await client.close();
  }
});

// Scenario 22: importedContent, performanceSnapshot, and importRun reads
// never expose MongoDB _id.
test("importedContent, performanceSnapshot, and importRun reads never expose MongoDB _id", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const contentRepo = new MongoImportedContentRepository(db);
    const snapshotRepo = new MongoPerformanceSnapshotRepository(db);
    const runRepo = new MongoImportRunRepository(db);
    const externalContentId = `ext_${Date.now()}`;

    const { record: content } = await contentRepo.upsertByIdentity({
      schemaVersion: "1.0.0",
      connectionId: "connection_instagram_primary",
      platform: "instagram",
      externalContentId,
      contentType: "reel",
      status: "active",
      platformData: {},
    });
    assert.ok(!("_id" in (content as object)));

    const { record: snapshot } = await snapshotRepo.upsertByHour({
      schemaVersion: "1.0.0",
      importedContentId: content.importedContentId,
      connectionId: "connection_instagram_primary",
      platform: "instagram",
      snapshotHour: "2026-07-29T06:00:00.000Z",
      collectedAt: new Date().toISOString(),
      metrics: { likes: 1 },
      dataCompleteness: "complete",
    });
    assert.ok(!("_id" in (snapshot as object)));

    const importRunId = `import_run_integration_test_${Date.now()}`;
    const run = await runRepo.save({
      schemaVersion: "1.0.0",
      importRunId,
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      recentContentLimit: 30,
      totals: { connections: 0, requestedItems: 0, createdItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0 },
      connectionResults: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const foundRun = await runRepo.findById(run.importRunId);
    assert.ok(!("_id" in (foundRun as object)));

    await db.collection("importedContents").deleteOne({ externalContentId });
    await db.collection("performanceSnapshots").deleteOne({ importedContentId: content.importedContentId });
    await db.collection("importRuns").deleteOne({ importRunId });
  } finally {
    await client.close();
  }
});

// Scenario 4/6 against the real unique index: repeated upserts by the
// same platform + externalContentId never create a second document.
test("upsertByIdentity against real MongoDB never creates a duplicate for the same identity", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const contentRepo = new MongoImportedContentRepository(db);
    const externalContentId = `ext_dedup_${Date.now()}`;

    const first = await contentRepo.upsertByIdentity({
      schemaVersion: "1.0.0",
      connectionId: "connection_pinterest_primary",
      platform: "pinterest",
      externalContentId,
      contentType: "pin",
      status: "active",
      platformData: {},
    });
    const second = await contentRepo.upsertByIdentity({
      schemaVersion: "1.0.0",
      connectionId: "connection_pinterest_primary",
      platform: "pinterest",
      externalContentId,
      contentType: "pin",
      status: "active",
      caption: "updated caption",
      platformData: {},
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.importedContentId, second.record.importedContentId);

    const matches = await db.collection("importedContents").find({ externalContentId }).toArray();
    assert.equal(matches.length, 1);

    await db.collection("importedContents").deleteOne({ externalContentId });
  } finally {
    await client.close();
  }
});

// Scenario 18 against the real partial unique index on importRuns.status.
test("MongoDB's partial unique index rejects a second simultaneous running importRun", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const runRepo = new MongoImportRunRepository(db);
    const runId1 = `import_run_conflict_test_1_${Date.now()}`;
    const runId2 = `import_run_conflict_test_2_${Date.now()}`;
    const base = {
      schemaVersion: "1.0.0" as const,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      recentContentLimit: 30,
      totals: { connections: 0, requestedItems: 0, createdItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0 },
      connectionResults: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await runRepo.createRunning({ ...base, importRunId: runId1 });
    await assert.rejects(
      () => runRepo.createRunning({ ...base, importRunId: runId2 }),
      RunningImportConflictError,
    );

    await db.collection("importRuns").deleteMany({ importRunId: { $in: [runId1, runId2] } });
  } finally {
    await client.close();
  }
});

// Scenario 24: Recent Content Limit persists after a restart.
test("Recent Content Limit persists after a fresh connection (simulated restart)", { skip }, async () => {
  const first = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(first.db);
    const settingsRepo = new MongoDataImportSettingsRepository(first.db);
    await settingsRepo.save({
      schemaVersion: "1.0.0",
      settingKey: "dataImport",
      recentContentLimit: 45,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } finally {
    await first.client.close();
  }

  const second = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    const settingsRepo = new MongoDataImportSettingsRepository(second.db);
    const found = await settingsRepo.find();
    assert.ok(found);
    assert.equal(found!.recentContentLimit, 45);

    // Reset to the default so it doesn't affect other tests/manual runs.
    await settingsRepo.save({
      schemaVersion: "1.0.0",
      settingKey: "dataImport",
      recentContentLimit: 30,
      createdAt: found!.createdAt,
      updatedAt: new Date().toISOString(),
    });
  } finally {
    await second.client.close();
  }
});

// Scenario 19: Data Import reads displayed items from MongoDB only.
test("DataImportService lists imported content from MongoDB, not from any in-process cache", { skip }, async () => {
  const { client, db } = await connectForTests(TEST_URI!, TEST_DATABASE);
  try {
    await ensureIndexes(db);
    const contentRepo = new MongoImportedContentRepository(db);
    const externalContentId = `ext_readpath_${Date.now()}`;
    const { record } = await contentRepo.upsertByIdentity({
      schemaVersion: "1.0.0",
      connectionId: "connection_instagram_primary",
      platform: "instagram",
      externalContentId,
      contentType: "reel",
      status: "active",
      caption: "Read-path proof",
      platformData: {},
    });

    const dataImportService = new DataImportService({
      connectionService: new ConnectionService({
        connectionRepository: new MongoPlatformConnectionRepository(db),
        credentialRepository: new MongoPlatformCredentialRepository(db),
        instagramConnector: new FakeInstagramConnector(),
        facebookConnector: new FakeFacebookConnector(),
        pinterestConnector: new FakePinterestConnector(),
      }),
      importedContentRepository: contentRepo,
      performanceSnapshotRepository: new MongoPerformanceSnapshotRepository(db),
      importRunRepository: new MongoImportRunRepository(db),
      settingsRepository: new MongoDataImportSettingsRepository(db),
      instagramConnector: new FakeInstagramConnector(),
      facebookConnector: new FakeFacebookConnector(),
      pinterestConnector: new FakePinterestConnector(),
    });

    const items = await dataImportService.listImportedContentWithLatestMetrics();
    const found = items.find((i) => i.importedContentId === record.importedContentId);
    assert.ok(found, "must read the record just persisted directly from MongoDB");
    assert.equal(found!.caption, "Read-path proof");

    await db.collection("importedContents").deleteOne({ externalContentId });
  } finally {
    await client.close();
  }
});
