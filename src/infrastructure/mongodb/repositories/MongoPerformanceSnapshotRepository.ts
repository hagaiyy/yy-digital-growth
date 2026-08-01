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

    // Built explicitly (not spread) so an absent optional field is never
    // written as an explicit `null`/`undefined` — Facebook and Pinterest
    // snapshots, which never set these, keep the exact same document
    // shape they always have.
    const optionalFields: Partial<
      Pick<
        typeof input,
        "accountType" | "contentType" | "providerMediaType" | "providerMediaProductType" | "metricRecords"
      >
    > = {};
    if (input.accountType !== undefined) optionalFields.accountType = input.accountType;
    if (input.contentType !== undefined) optionalFields.contentType = input.contentType;
    if (input.providerMediaType !== undefined) optionalFields.providerMediaType = input.providerMediaType;
    if (input.providerMediaProductType !== undefined) {
      optionalFields.providerMediaProductType = input.providerMediaProductType;
    }
    if (input.metricRecords !== undefined) optionalFields.metricRecords = input.metricRecords;

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
          ...optionalFields,
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
