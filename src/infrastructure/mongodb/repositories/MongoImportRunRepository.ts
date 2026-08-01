import type { Db } from "mongodb";
import { MongoServerError } from "mongodb";

import type { ImportRun } from "@/domain/models/ImportRun";
import {
  RunningImportConflictError,
  type ImportRunRepository,
} from "@/domain/repositories/ImportRunRepository";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export class MongoImportRunRepository implements ImportRunRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<ImportRun>("importRuns");
  }

  async createRunning(run: ImportRun): Promise<ImportRun> {
    try {
      await this.collection.insertOne({ ...run });
      return run;
    } catch (error) {
      // The partial unique index on { status: "running" } is what
      // actually enforces "only one running import at a time" — this
      // catch is just translating that database-level guarantee into a
      // typed application error.
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR_CODE) {
        throw new RunningImportConflictError();
      }
      throw error;
    }
  }

  async save(run: ImportRun): Promise<ImportRun> {
    await this.collection.replaceOne({ importRunId: run.importRunId }, run, { upsert: true });
    return run;
  }

  async findLatest(): Promise<ImportRun | null> {
    const results = await this.collection
      .find({}, { projection: { _id: 0 } })
      .sort({ startedAt: -1 })
      .limit(1)
      .toArray();
    return results[0] ?? null;
  }

  async findById(importRunId: string): Promise<ImportRun | null> {
    return this.collection.findOne({ importRunId }, { projection: { _id: 0 } });
  }

  async findRunning(): Promise<ImportRun | null> {
    return this.collection.findOne({ status: "running" }, { projection: { _id: 0 } });
  }
}
