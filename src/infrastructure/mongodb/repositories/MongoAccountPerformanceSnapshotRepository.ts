import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";

import type { AccountPerformanceSnapshot } from "@/domain/models/AccountPerformanceSnapshot";
import type {
  AccountPerformanceSnapshotRepository,
  UpsertAccountPerformanceSnapshotInput,
  UpsertAccountPerformanceSnapshotResult,
} from "@/domain/repositories/AccountPerformanceSnapshotRepository";

function groupKeyFor(snapshot: AccountPerformanceSnapshot): string {
  return `${snapshot.period}::${snapshot.since ?? ""}::${snapshot.until ?? ""}::${snapshot.timeframe ?? ""}::${snapshot.breakdown ?? ""}`;
}

export class MongoAccountPerformanceSnapshotRepository implements AccountPerformanceSnapshotRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<AccountPerformanceSnapshot>("accountPerformanceSnapshots");
  }

  async findByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    return this.collection
      .find({ connectionId }, { projection: { _id: 0 } })
      .sort({ snapshotHour: -1 })
      .toArray();
  }

  // One "latest" row per distinct (period, since, until, timeframe)
  // group — never just the single most recent document, since a single
  // import can produce several account snapshots in the same hour (e.g.
  // day-period aggregates and lifetime-period demographics are
  // different groups).
  async findLatestByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    const all = await this.collection
      .find({ connectionId }, { projection: { _id: 0 } })
      .sort({ snapshotHour: -1 })
      .toArray();

    const latestByGroup = new Map<string, AccountPerformanceSnapshot>();
    for (const snapshot of all) {
      const groupKey = groupKeyFor(snapshot);
      if (!latestByGroup.has(groupKey)) latestByGroup.set(groupKey, snapshot);
    }
    return Array.from(latestByGroup.values());
  }

  async upsertByHour(
    input: UpsertAccountPerformanceSnapshotInput,
  ): Promise<UpsertAccountPerformanceSnapshotResult> {
    const now = new Date().toISOString();
    const newId = `account_performance_snapshot_${randomUUID()}`;

    const optionalFields: Partial<Pick<typeof input, "accountType" | "since" | "until" | "timeframe" | "breakdown">> =
      {};
    if (input.accountType !== undefined) optionalFields.accountType = input.accountType;
    if (input.since !== undefined) optionalFields.since = input.since;
    if (input.until !== undefined) optionalFields.until = input.until;
    if (input.timeframe !== undefined) optionalFields.timeframe = input.timeframe;
    if (input.breakdown !== undefined) optionalFields.breakdown = input.breakdown;

    const record = await this.collection.findOneAndUpdate(
      {
        connectionId: input.connectionId,
        snapshotHour: input.snapshotHour,
        period: input.period,
        since: input.since ?? { $exists: false },
        until: input.until ?? { $exists: false },
        timeframe: input.timeframe ?? { $exists: false },
        breakdown: input.breakdown ?? { $exists: false },
      },
      {
        $set: {
          platform: input.platform,
          collectedAt: input.collectedAt,
          metrics: input.metrics,
          completeness: input.completeness,
          updatedAt: now,
          ...optionalFields,
        },
        $setOnInsert: {
          schemaVersion: "1.0.0",
          accountPerformanceSnapshotId: newId,
          connectionId: input.connectionId,
          snapshotHour: input.snapshotHour,
          period: input.period,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } },
    );

    if (!record) {
      throw new Error("Failed to upsert accountPerformanceSnapshot record.");
    }

    return { record, created: record.createdAt === now };
  }
}
