import type { Db } from "mongodb";

export async function ensureIndexes(db: Db): Promise<void> {
  await db
    .collection("platformConnections")
    .createIndex({ connectionId: 1 }, { unique: true });
  await db
    .collection("platformCredentials")
    .createIndex({ connectionId: 1 }, { unique: true });

  await db
    .collection("importedContents")
    .createIndex({ platform: 1, externalContentId: 1 }, { unique: true });
  await db.collection("importedContents").createIndex({ connectionId: 1 });
  await db.collection("importedContents").createIndex({ publishedAt: 1 });

  await db
    .collection("performanceSnapshots")
    .createIndex({ importedContentId: 1, snapshotHour: 1 }, { unique: true });
  await db.collection("performanceSnapshots").createIndex({ connectionId: 1 });
  await db.collection("performanceSnapshots").createIndex({ platform: 1 });
  await db.collection("performanceSnapshots").createIndex({ collectedAt: 1 });

  // Account-level insights are never mixed into a content
  // performanceSnapshot — one row per connectionId + snapshotHour +
  // period + (since/until or timeframe), since Meta's account metrics
  // describe the whole account, not one piece of content.
  await db.collection("accountPerformanceSnapshots").createIndex(
    { connectionId: 1, snapshotHour: 1, period: 1, since: 1, until: 1, timeframe: 1 },
    { unique: true },
  );
  await db.collection("accountPerformanceSnapshots").createIndex({ connectionId: 1 });
  await db.collection("accountPerformanceSnapshots").createIndex({ platform: 1 });
  await db.collection("accountPerformanceSnapshots").createIndex({ collectedAt: 1 });

  await db.collection("importRuns").createIndex({ importRunId: 1 }, { unique: true });
  await db.collection("importRuns").createIndex({ startedAt: 1 });
  await db.collection("importRuns").createIndex({ status: 1 });
  // Enforces "only one running import at a time" at the database level:
  // a second insertOne() with status "running" fails with a duplicate
  // key error, which MongoImportRunRepository translates into
  // RunningImportConflictError.
  await db.collection("importRuns").createIndex(
    { status: 1 },
    { unique: true, partialFilterExpression: { status: "running" }, name: "unique_running_run" },
  );

  await db.collection("dataImportSettings").createIndex({ settingKey: 1 }, { unique: true });
}
