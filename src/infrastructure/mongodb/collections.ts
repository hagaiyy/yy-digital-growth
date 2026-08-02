import type { Db } from "mongodb";

// createIndex() with a changed key spec never replaces an existing
// index under a different auto-generated name — it just adds a second
// one, leaving the old (now-incorrect) uniqueness constraint active.
// This drops any existing index on the collection whose key set no
// longer matches the current desired spec, so a schema change to a
// unique index is actually picked up rather than silently coexisting
// with stale constraints. Safe to call every time: a no-op once the
// only index present is already correct.
async function dropStaleIndexes(db: Db, collectionName: string, desiredKey: Record<string, 1>): Promise<boolean> {
  const desiredKeys = Object.keys(desiredKey);
  let existing: Array<{ name?: string; key: Record<string, unknown>; unique?: boolean }>;
  try {
    existing = await db.collection(collectionName).indexes();
  } catch {
    // Collection does not exist yet — nothing to drop.
    return false;
  }
  let droppedAny = false;
  for (const index of existing) {
    if (!index.unique || !index.name || index.name === "_id_") continue;
    const existingKeys = Object.keys(index.key);
    const matches =
      existingKeys.length === desiredKeys.length && existingKeys.every((key) => key in desiredKey);
    if (!matches) {
      await db.collection(collectionName).dropIndex(index.name);
      droppedAny = true;
    }
  }
  return droppedAny;
}

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
  // period + (since/until or timeframe) + breakdown, since Meta's
  // account metrics describe the whole account, not one piece of
  // content, and different breakdown values (e.g. profile_links_taps'
  // contact_button_type vs the plain aggregate group) would otherwise
  // collide despite sharing every other dimension.
  const accountSnapshotUniqueKey = {
    connectionId: 1 as const,
    snapshotHour: 1 as const,
    period: 1 as const,
    since: 1 as const,
    until: 1 as const,
    timeframe: 1 as const,
    breakdown: 1 as const,
  };
  const migratedAccountSnapshotIndex = await dropStaleIndexes(
    db,
    "accountPerformanceSnapshots",
    accountSnapshotUniqueKey,
  );
  if (migratedAccountSnapshotIndex) {
    // accountPerformanceSnapshots was introduced in this same change —
    // every existing row was written under the old, narrower uniqueness
    // key (missing `breakdown`) and is safe to discard: it is disposable
    // verification data, not real historical account insights, and
    // would otherwise violate the new unique index and block its
    // creation. The next import run repopulates it correctly.
    await db.collection("accountPerformanceSnapshots").deleteMany({});
  }
  await db.collection("accountPerformanceSnapshots").createIndex(accountSnapshotUniqueKey, { unique: true });
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

  await db
    .collection("metricVisibilityPreferences")
    .createIndex({ platform: 1, contentType: 1 }, { unique: true });
}
