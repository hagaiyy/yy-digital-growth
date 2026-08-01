import { randomUUID } from "node:crypto";

import type { ImportedContent } from "@/domain/models/ImportedContent";
import type {
  ImportedContentRepository,
  UpsertImportedContentInput,
  UpsertImportedContentResult,
} from "@/domain/repositories/ImportedContentRepository";
import type { Platform } from "@/domain/models/PlatformConnection";

import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import type {
  PerformanceSnapshotRepository,
  UpsertPerformanceSnapshotInput,
  UpsertPerformanceSnapshotResult,
} from "@/domain/repositories/PerformanceSnapshotRepository";

import type { AccountPerformanceSnapshot } from "@/domain/models/AccountPerformanceSnapshot";
import type {
  AccountPerformanceSnapshotRepository,
  UpsertAccountPerformanceSnapshotInput,
  UpsertAccountPerformanceSnapshotResult,
} from "@/domain/repositories/AccountPerformanceSnapshotRepository";

import type { ImportRun } from "@/domain/models/ImportRun";
import {
  RunningImportConflictError,
  type ImportRunRepository,
} from "@/domain/repositories/ImportRunRepository";

import type { DataImportSettings } from "@/domain/models/DataImportSettings";
import type { DataImportSettingsRepository } from "@/domain/repositories/DataImportSettingsRepository";

export class InMemoryImportedContentRepository implements ImportedContentRepository {
  private readonly records = new Map<string, ImportedContent>();

  async list(): Promise<ImportedContent[]> {
    return Array.from(this.records.values());
  }

  async findById(importedContentId: string): Promise<ImportedContent | null> {
    return this.records.get(importedContentId) ?? null;
  }

  async findByPlatformAndExternalId(
    platform: Platform,
    externalContentId: string,
  ): Promise<ImportedContent | null> {
    return (
      Array.from(this.records.values()).find(
        (r) => r.platform === platform && r.externalContentId === externalContentId,
      ) ?? null
    );
  }

  async upsertByIdentity(input: UpsertImportedContentInput): Promise<UpsertImportedContentResult> {
    const now = new Date().toISOString();
    const existing = await this.findByPlatformAndExternalId(input.platform, input.externalContentId);

    if (existing) {
      const updated: ImportedContent = {
        ...existing,
        connectionId: input.connectionId,
        contentType: input.contentType,
        status: input.status,
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        permalink: input.permalink,
        thumbnailUrl: input.thumbnailUrl,
        publishedAt: input.publishedAt,
        platformData: input.platformData,
        lastImportedAt: now,
        updatedAt: now,
      };
      this.records.set(updated.importedContentId, updated);
      return { record: updated, created: false };
    }

    const created: ImportedContent = {
      ...input,
      importedContentId: `imported_content_${randomUUID()}`,
      firstImportedAt: now,
      lastImportedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(created.importedContentId, created);
    return { record: created, created: true };
  }
}

export class InMemoryPerformanceSnapshotRepository implements PerformanceSnapshotRepository {
  private readonly records = new Map<string, PerformanceSnapshot>();

  private key(importedContentId: string, snapshotHour: string): string {
    return `${importedContentId}::${snapshotHour}`;
  }

  async findByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot[]> {
    return Array.from(this.records.values())
      .filter((r) => r.importedContentId === importedContentId)
      .sort((a, b) => (a.snapshotHour < b.snapshotHour ? 1 : -1));
  }

  async findLatestByImportedContentId(importedContentId: string): Promise<PerformanceSnapshot | null> {
    const all = await this.findByImportedContentId(importedContentId);
    return all[0] ?? null;
  }

  async upsertByHour(
    input: UpsertPerformanceSnapshotInput,
  ): Promise<UpsertPerformanceSnapshotResult> {
    const now = new Date().toISOString();
    const key = this.key(input.importedContentId, input.snapshotHour);
    const existing = this.records.get(key);

    if (existing) {
      const updated: PerformanceSnapshot = {
        ...existing,
        connectionId: input.connectionId,
        platform: input.platform,
        collectedAt: input.collectedAt,
        metrics: input.metrics,
        dataCompleteness: input.dataCompleteness,
        accountType: input.accountType,
        contentType: input.contentType,
        providerMediaType: input.providerMediaType,
        providerMediaProductType: input.providerMediaProductType,
        metricRecords: input.metricRecords,
        updatedAt: now,
      };
      this.records.set(key, updated);
      return { record: updated, created: false };
    }

    const created: PerformanceSnapshot = {
      ...input,
      schemaVersion: "1.0.0",
      performanceSnapshotId: `performance_snapshot_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(key, created);
    return { record: created, created: true };
  }
}

export class InMemoryAccountPerformanceSnapshotRepository implements AccountPerformanceSnapshotRepository {
  private readonly records = new Map<string, AccountPerformanceSnapshot>();

  private key(connectionId: string, snapshotHour: string, period: string, since?: string, until?: string, timeframe?: string): string {
    return `${connectionId}::${snapshotHour}::${period}::${since ?? ""}::${until ?? ""}::${timeframe ?? ""}`;
  }

  async findByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    return Array.from(this.records.values())
      .filter((r) => r.connectionId === connectionId)
      .sort((a, b) => (a.snapshotHour < b.snapshotHour ? 1 : -1));
  }

  async findLatestByConnectionId(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    const all = await this.findByConnectionId(connectionId);
    const latestByGroup = new Map<string, AccountPerformanceSnapshot>();
    for (const snapshot of all) {
      const groupKey = `${snapshot.period}::${snapshot.since ?? ""}::${snapshot.until ?? ""}::${snapshot.timeframe ?? ""}`;
      if (!latestByGroup.has(groupKey)) latestByGroup.set(groupKey, snapshot);
    }
    return Array.from(latestByGroup.values());
  }

  async upsertByHour(
    input: UpsertAccountPerformanceSnapshotInput,
  ): Promise<UpsertAccountPerformanceSnapshotResult> {
    const now = new Date().toISOString();
    const key = this.key(input.connectionId, input.snapshotHour, input.period, input.since, input.until, input.timeframe);
    const existing = this.records.get(key);

    if (existing) {
      const updated: AccountPerformanceSnapshot = {
        ...existing,
        platform: input.platform,
        accountType: input.accountType,
        collectedAt: input.collectedAt,
        completeness: input.completeness,
        metrics: input.metrics,
        updatedAt: now,
      };
      this.records.set(key, updated);
      return { record: updated, created: false };
    }

    const created: AccountPerformanceSnapshot = {
      ...input,
      schemaVersion: "1.0.0",
      accountPerformanceSnapshotId: `account_performance_snapshot_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(key, created);
    return { record: created, created: true };
  }
}

export class InMemoryImportRunRepository implements ImportRunRepository {
  private readonly records = new Map<string, ImportRun>();

  async createRunning(run: ImportRun): Promise<ImportRun> {
    const alreadyRunning = Array.from(this.records.values()).some((r) => r.status === "running");
    if (alreadyRunning) throw new RunningImportConflictError();
    this.records.set(run.importRunId, { ...run });
    return run;
  }

  async save(run: ImportRun): Promise<ImportRun> {
    this.records.set(run.importRunId, { ...run });
    return run;
  }

  async findLatest(): Promise<ImportRun | null> {
    const all = Array.from(this.records.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return all[0] ?? null;
  }

  async findById(importRunId: string): Promise<ImportRun | null> {
    return this.records.get(importRunId) ?? null;
  }

  async findRunning(): Promise<ImportRun | null> {
    return Array.from(this.records.values()).find((r) => r.status === "running") ?? null;
  }
}

export class InMemoryDataImportSettingsRepository implements DataImportSettingsRepository {
  private record: DataImportSettings | null = null;

  async find(): Promise<DataImportSettings | null> {
    return this.record;
  }

  async save(settings: DataImportSettings): Promise<DataImportSettings> {
    this.record = { ...settings };
    return this.record;
  }
}
