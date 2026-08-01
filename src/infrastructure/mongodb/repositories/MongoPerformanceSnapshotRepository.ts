import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";

import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import type {
  PerformanceSnapshotRepository,
  UpsertPerformanceSnapshotInput,
  UpsertPerformanceSnapshotResult,
} from "@/domain/repositories/PerformanceSnapshotRepository";

export class MongoPerformanceSnapshotRepository implements PerformanceSnapshotRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<PerformanceSnapshot>("performanceSnapshots");
  }

  async findByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot[]> {
    return this.collection
      .find({ importedContentId }, { projection: { _id: 0 } })
      .sort({ snapshotHour: -1 })
      .toArray();
  }

  async findLatestByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot | null> {
    const results = await this.collection
      .find({ importedContentId }, { projection: { _id: 0 } })
      .sort({ snapshotHour: -1 })
      .limit(1)
      .toArray();
    return results[0] ?? null;
  }

  async upsertByHour(
    input: UpsertPerformanceSnapshotInput,
  ): Promise<UpsertPerformanceSnapshotResult> {
    const now = new Date().toISOString();
    const newId = `performance_snapshot_${randomUUID()}`;

    const record = await this.collection.findOneAndUpdate(
      { importedContentId: input.importedContentId, snapshotHour: input.snapshotHour },
      {
        $set: {
          connectionId: input.connectionId,
          platform: input.platform,
          collectedAt: input.collectedAt,
          metrics: input.metrics,
          dataCompleteness: input.dataCompleteness,
          updatedAt: now,
        },
        $setOnInsert: {
          schemaVersion: "1.0.0",
          performanceSnapshotId: newId,
          importedContentId: input.importedContentId,
          snapshotHour: input.snapshotHour,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } },
    );

    if (!record) {
      throw new Error("Failed to upsert performanceSnapshot record.");
    }

    return { record, created: record.createdAt === now };
  }
}
