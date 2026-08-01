import { MongoClient, type Db } from "mongodb";

import { ensureIndexes } from "@/infrastructure/mongodb/collections";

let cachedDb: Db | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  if (!uri || !databaseName) {
    throw new Error("MONGODB_URI and MONGODB_DATABASE must be configured.");
  }

  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  const db = client.db(databaseName);
  // Idempotent: safe to run on every cold start. The partial unique
  // index on importRuns.status is load-bearing for preventing
  // simultaneous import runs, so it must exist on the real database,
  // not only whichever database tests happen to call ensureIndexes on.
  await ensureIndexes(db);
  cachedDb = db;
  return cachedDb;
}

export async function connectForTests(uri: string, databaseName: string) {
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  return { client, db: client.db(databaseName) };
}
