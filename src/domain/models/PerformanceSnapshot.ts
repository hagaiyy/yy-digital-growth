import type { Platform } from "@/domain/models/PlatformConnection";

export type DataCompleteness = "complete" | "partial" | "unavailable";

export interface PerformanceSnapshot {
  schemaVersion: "1.0.0";
  performanceSnapshotId: string;
  importedContentId: string;
  connectionId: string;
  platform: Platform;
  snapshotHour: string;
  collectedAt: string;
  // A key absent here was never returned by the platform; a value of
  // `null` means the platform explicitly reported it unavailable; `0`
  // is a real observed zero. Never collapse these into each other.
  metrics: Record<string, number | string | null>;
  dataCompleteness: DataCompleteness;
  createdAt: string;
  updatedAt: string;
}
