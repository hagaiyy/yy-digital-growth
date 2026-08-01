import type { AccountPerformanceSnapshot } from "@/domain/models/AccountPerformanceSnapshot";

export type UpsertAccountPerformanceSnapshotInput = Omit<
  AccountPerformanceSnapshot,
  "accountPerformanceSnapshotId" | "createdAt" | "updatedAt"
>;

export interface UpsertAccountPerformanceSnapshotResult {
  record: AccountPerformanceSnapshot;
  created: boolean;
}

export interface AccountPerformanceSnapshotRepository {
  findByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]>;
  findLatestByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]>;
  // Upsert key is connectionId + snapshotHour + period + timeframe — one
  // account snapshot per that combination, never mixed with content
  // snapshots.
  upsertByHour(
    input: UpsertAccountPerformanceSnapshotInput,
  ): Promise<UpsertAccountPerformanceSnapshotResult>;
}
