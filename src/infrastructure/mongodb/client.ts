import { MongoClient, type Db } from "mongodb";

import { ensureIndexes } from "@/infrastructure/mongodb/collections";
import { tagDiagnosticStage } from "@/infrastructure/mongodb/diagnostics";

let cachedDb: Db | null = null;

// Every throw point below is tagged with the stage it belongs to (via a
// non-enumerable property on the *same* error — never a wrapped error),
// so a caller can log which stage failed without guessing from the error
// message. Tagging never changes an error's type, message, or
// instanceof-checkability — existing callers (e.g. toErrorResponse's
// "MONGODB_URI" message check) see byte-identical errors to before.
export async function getDb(): Promise<Db> {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  if (!uri || !databaseName) {
    throw tagDiagnosticStage(
      new Error("MONGODB_URI and MONGODB_DATABASE must be configured."),
      "configuration",
    );
  }

  const client = new MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
  } catch (error) {
    throw tagDiagnosticStage(error, "connection");
  }

  let db: Db;
  try {
    db = client.db(databaseName);
  } catch (error) {
    throw tagDiagnosticStage(error, "database");
  }

  try {
    // Idempotent: safe to run on every cold start. The partial unique
    // index on importRuns.status is load-bearing for preventing
    // simultaneous import runs, so it must exist on the real database,
    // not only whichever database tests happen to call ensureIndexes on.
    await ensureIndexes(db);
  } catch (error) {
    throw tagDiagnosticStage(error, "collection");
  }

  cachedDb = db;
  return cachedDb;
}

export async function connectForTests(uri: string, databaseName: string) {
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  return { client, db: client.db(databaseName) };
}
