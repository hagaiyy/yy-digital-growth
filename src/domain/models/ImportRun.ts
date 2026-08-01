import type { Platform } from "@/domain/models/PlatformConnection";

export type ImportRunStatus = "running" | "completed" | "completedWithErrors" | "failed";

export type ItemResultStatus = "success" | "partial" | "failed" | "skipped" | "unsupported";

export interface ItemResult {
  externalContentId?: string;
  contentLabel?: string;
  platform: Platform;
  status: ItemResultStatus;
  safeReasonCode?: string;
  safeMessage?: string;
  successfulMetricNames?: string[];
  failedMetricNames?: string[];
}

export interface ConnectionResult {
  connectionId: string;
  platform: Platform;
  status: ItemResultStatus;
  requestedCount?: number;
  createdCount?: number;
  updatedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  safeErrorCode?: string;
  safeErrorMessage?: string;
  itemResults?: ItemResult[];
}

export interface ImportRunTotals {
  connections: number;
  requestedItems: number;
  createdItems: number;
  updatedItems: number;
  failedItems: number;
  skippedItems: number;
}

export interface ImportRun {
  schemaVersion: "1.0.0";
  importRunId: string;
  status: ImportRunStatus;
  startedAt: string;
  completedAt?: string;
  recentContentLimit: number;
  totals: ImportRunTotals;
  connectionResults: ConnectionResult[];
  safeErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
