import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";

export type UpsertPerformanceSnapshotInput = Omit<
  PerformanceSnapshot,
  "performanceSnapshotId" | "createdAt" | "updatedAt"
>;

export interface UpsertPerformanceSnapshotResult {
  record: PerformanceSnapshot;
  created: boolean;
}

export interface PerformanceSnapshotRepository {
  findByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot[]>;
  findLatestByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot | null>;
  upsertByHour(input: UpsertPerformanceSnapshotInput): Promise<UpsertPerformanceSnapshotResult>;
}
