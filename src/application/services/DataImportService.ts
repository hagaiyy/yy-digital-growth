import { randomUUID } from "node:crypto";

import {
  DEFAULT_RECENT_CONTENT_LIMIT,
  MAX_RECENT_CONTENT_LIMIT,
  MIN_RECENT_CONTENT_LIMIT,
  type DataImportSettings,
} from "@/domain/models/DataImportSettings";
import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import type { AccountPerformanceSnapshot } from "@/domain/models/AccountPerformanceSnapshot";
import type { ConnectionResult, ImportRun, ItemResultStatus } from "@/domain/models/ImportRun";
import { isEligibleDataImportSource, type PlatformConnection } from "@/domain/models/PlatformConnection";

import type { ImportedContentRepository } from "@/domain/repositories/ImportedContentRepository";
import type { PerformanceSnapshotRepository } from "@/domain/repositories/PerformanceSnapshotRepository";
import type { AccountPerformanceSnapshotRepository } from "@/domain/repositories/AccountPerformanceSnapshotRepository";
import { RunningImportConflictError, type ImportRunRepository } from "@/domain/repositories/ImportRunRepository";
import type { DataImportSettingsRepository } from "@/domain/repositories/DataImportSettingsRepository";

import type { ConnectionService } from "@/application/services/ConnectionService";
import { SafeServiceError } from "@/application/services/ConnectionService";
import type { FacebookConnector } from "@/application/connectors/FacebookConnector";
import type { InstagramConnector } from "@/application/connectors/InstagramConnector";
import type { PinterestConnector } from "@/application/connectors/PinterestConnector";
import { ConnectorError, type MetricsFetchOutcome, type RecentContentItem } from "@/application/connectors/types";
import { mapWithConcurrency } from "@/application/util/concurrency";

const CONNECTION_CONCURRENCY = 3;
const ITEM_CONCURRENCY = 5;
const STALE_RUNNING_THRESHOLD_MS = 15 * 60 * 1000;

export interface ImportedContentListItem extends ImportedContent {
  latestPerformance: PerformanceSnapshot | null;
}

interface ItemOutcome {
  externalContentId: string;
  contentLabel: string;
  status: ItemResultStatus;
  safeReasonCode?: string;
  safeMessage?: string;
  successfulMetricNames?: string[];
  failedMetricNames?: string[];
  created: boolean;
  updated: boolean;
}

function truncateToHourIso(iso: string): string {
  const date = new Date(iso);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function labelFor(item: RecentContentItem): string {
  if (item.title) return item.title;
  if (item.caption) return item.caption.slice(0, 60);
  return item.externalContentId;
}

function connectionFailure(
  connection: PlatformConnection,
  safeErrorCode: string,
  safeErrorMessage: string,
): ConnectionResult {
  return {
    connectionId: connection.connectionId,
    platform: connection.platform,
    status: "failed",
    requestedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    safeErrorCode,
    safeErrorMessage,
  };
}

function connectionFailureFromError(connection: PlatformConnection, error: unknown): ConnectionResult {
  if (error instanceof ConnectorError) {
    return connectionFailure(connection, error.code, error.safeMessage);
  }
  return connectionFailure(connection, "unexpectedError", "An unexpected error occurred during import.");
}

function buildConnectionResult(connection: PlatformConnection, outcomes: ItemOutcome[]): ConnectionResult {
  const requestedCount = outcomes.length;
  const createdCount = outcomes.filter((o) => o.created).length;
  const updatedCount = outcomes.filter((o) => o.updated).length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;
  const skippedCount = outcomes.filter((o) => o.status === "skipped").length;
  const itemResults = outcomes
    .filter((o) => o.status !== "success")
    .map((o) => ({
      externalContentId: o.externalContentId,
      contentLabel: o.contentLabel,
      platform: connection.platform,
      status: o.status,
      safeReasonCode: o.safeReasonCode,
      safeMessage: o.safeMessage,
      successfulMetricNames: o.successfulMetricNames,
      failedMetricNames: o.failedMetricNames,
    }));

  let status: ItemResultStatus;
  if (requestedCount === 0 || outcomes.every((o) => o.status === "success")) {
    status = "success";
  } else if (outcomes.every((o) => o.status === "failed")) {
    status = "failed";
  } else {
    status = "partial";
  }

  return {
    connectionId: connection.connectionId,
    platform: connection.platform,
    status,
    requestedCount,
    createdCount,
    updatedCount,
    failedCount,
    skippedCount,
    itemResults: itemResults.length > 0 ? itemResults : undefined,
  };
}

export interface DataImportServiceDependencies {
  connectionService: ConnectionService;
  importedContentRepository: ImportedContentRepository;
  performanceSnapshotRepository: PerformanceSnapshotRepository;
  accountPerformanceSnapshotRepository: AccountPerformanceSnapshotRepository;
  importRunRepository: ImportRunRepository;
  settingsRepository: DataImportSettingsRepository;
  instagramConnector: InstagramConnector;
  facebookConnector: FacebookConnector;
  pinterestConnector: PinterestConnector;
  now?: () => string;
}

export class DataImportService {
  private readonly connectionService: ConnectionService;
  private readonly importedContentRepository: ImportedContentRepository;
  private readonly performanceSnapshotRepository: PerformanceSnapshotRepository;
  private readonly accountPerformanceSnapshotRepository: AccountPerformanceSnapshotRepository;
  private readonly importRunRepository: ImportRunRepository;
  private readonly settingsRepository: DataImportSettingsRepository;
  private readonly instagramConnector: InstagramConnector;
  private readonly facebookConnector: FacebookConnector;
  private readonly pinterestConnector: PinterestConnector;
  private readonly now: () => string;

  constructor(deps: DataImportServiceDependencies) {
    this.connectionService = deps.connectionService;
    this.importedContentRepository = deps.importedContentRepository;
    this.performanceSnapshotRepository = deps.performanceSnapshotRepository;
    this.accountPerformanceSnapshotRepository = deps.accountPerformanceSnapshotRepository;
    this.importRunRepository = deps.importRunRepository;
    this.settingsRepository = deps.settingsRepository;
    this.instagramConnector = deps.instagramConnector;
    this.facebookConnector = deps.facebookConnector;
    this.pinterestConnector = deps.pinterestConnector;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getSettings(): Promise<DataImportSettings> {
    const existing = await this.settingsRepository.find();
    if (existing) return existing;
    const timestamp = this.now();
    return this.settingsRepository.save({
      schemaVersion: "1.0.0",
      settingKey: "dataImport",
      recentContentLimit: DEFAULT_RECENT_CONTENT_LIMIT,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async updateSettings(recentContentLimit: number): Promise<DataImportSettings> {
    if (
      !Number.isInteger(recentContentLimit) ||
      recentContentLimit < MIN_RECENT_CONTENT_LIMIT ||
      recentContentLimit > MAX_RECENT_CONTENT_LIMIT
    ) {
      throw new SafeServiceError(
        "invalidRecentContentLimit",
        `Recent Content Limit must be a whole number between ${MIN_RECENT_CONTENT_LIMIT} and ${MAX_RECENT_CONTENT_LIMIT}.`,
      );
    }
    const existing = await this.getSettings();
    return this.settingsRepository.save({
      ...existing,
      recentContentLimit,
      updatedAt: this.now(),
    });
  }

  async getLatestRun(): Promise<ImportRun | null> {
    return this.importRunRepository.findLatest();
  }

  async getRun(importRunId: string): Promise<ImportRun | null> {
    return this.importRunRepository.findById(importRunId);
  }

  async listImportedContentWithLatestMetrics(): Promise<ImportedContentListItem[]> {
    const items = await this.importedContentRepository.list();
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        latestPerformance: await this.performanceSnapshotRepository.findLatestByImportedContentId(
          item.importedContentId,
        ),
      })),
    );
  }

  async getImportedContentDetail(importedContentId: string): Promise<ImportedContent | null> {
    return this.importedContentRepository.findById(importedContentId);
  }

  async getPerformanceHistory(importedContentId: string): Promise<PerformanceSnapshot[]> {
    return this.performanceSnapshotRepository.findByImportedContentId(importedContentId);
  }

  // One or more rows per connection — account-level insights are
  // grouped by Meta request-parameter shape (see
  // planInstagramAccountInsightsRequest), never a single flat record.
  async getLatestAccountPerformance(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    return this.accountPerformanceSnapshotRepository.findLatestByConnectionId(connectionId);
  }

  async getAccountPerformanceHistory(connectionId: string): Promise<AccountPerformanceSnapshot[]> {
    return this.accountPerformanceSnapshotRepository.findByConnectionId(connectionId);
  }

  private isStale(run: ImportRun): boolean {
    return Date.now() - Date.parse(run.startedAt) > STALE_RUNNING_THRESHOLD_MS;
  }

  private async importOneItem(
    connection: PlatformConnection,
    item: RecentContentItem,
    fetchMetrics: (importedContentId: string) => Promise<MetricsFetchOutcome>,
  ): Promise<ItemOutcome> {
    const contentLabel = labelFor(item);

    let upsertResult;
    try {
      upsertResult = await this.importedContentRepository.upsertByIdentity({
        schemaVersion: "1.0.0",
        connectionId: connection.connectionId,
        platform: connection.platform,
        externalContentId: item.externalContentId,
        contentType: item.contentType,
        status: "active",
        title: item.title ?? null,
        caption: item.caption ?? null,
        hashtags: item.hashtags ?? [],
        permalink: item.permalink ?? null,
        thumbnailUrl: item.thumbnailUrl ?? null,
        publishedAt: item.publishedAt ?? null,
        platformData: item.platformData ?? {},
      });
    } catch {
      return {
        externalContentId: item.externalContentId,
        contentLabel,
        status: "failed",
        safeReasonCode: "contentSaveFailed",
        safeMessage: "This content item could not be saved.",
        created: false,
        updated: false,
      };
    }

    const { record, created } = upsertResult;
    const metricsOutcome = await fetchMetrics(record.importedContentId);
    const snapshotHour = truncateToHourIso(this.now());

    // The additive per-platform snapshot fields (accountType, contentType,
    // providerMediaType/providerMediaProductType for Instagram,
    // providerObjectType for Facebook, metricRecords for both) are gated
    // on platform explicitly, not on whether the outcome happens to
    // carry them — Pinterest's snapshot documents must keep the exact
    // shape they always had.
    const platformFields =
      metricsOutcome.kind !== "failed" && connection.platform === "instagram"
        ? {
            accountType: metricsOutcome.accountType,
            contentType: item.contentType,
            providerMediaType: metricsOutcome.providerMediaType,
            providerMediaProductType: metricsOutcome.providerMediaProductType,
            metricRecords: metricsOutcome.metricRecords,
          }
        : metricsOutcome.kind !== "failed" && connection.platform === "facebook"
          ? {
              contentType: item.contentType,
              providerObjectType: metricsOutcome.providerObjectType,
              metricRecords: metricsOutcome.metricRecords,
            }
          : {};

    if (metricsOutcome.kind === "success") {
      await this.performanceSnapshotRepository.upsertByHour({
        schemaVersion: "1.0.0",
        importedContentId: record.importedContentId,
        connectionId: connection.connectionId,
        platform: connection.platform,
        snapshotHour,
        collectedAt: this.now(),
        metrics: metricsOutcome.metrics,
        dataCompleteness: metricsOutcome.dataCompleteness,
        ...platformFields,
      });
      const partial = metricsOutcome.dataCompleteness === "partial";
      return {
        externalContentId: item.externalContentId,
        contentLabel,
        status: partial ? "partial" : "success",
        safeReasonCode: partial ? "partialMetrics" : undefined,
        safeMessage: partial ? "Some metrics were not returned for this item." : undefined,
        successfulMetricNames: metricsOutcome.successfulMetrics,
        failedMetricNames: metricsOutcome.failedMetrics.map((f) => f.metric),
        created,
        updated: !created,
      };
    }

    if (metricsOutcome.kind === "unsupported") {
      await this.performanceSnapshotRepository.upsertByHour({
        schemaVersion: "1.0.0",
        importedContentId: record.importedContentId,
        connectionId: connection.connectionId,
        platform: connection.platform,
        snapshotHour,
        collectedAt: this.now(),
        metrics: {},
        dataCompleteness: metricsOutcome.dataCompleteness ?? "unavailable",
        ...platformFields,
      });
      return {
        externalContentId: item.externalContentId,
        contentLabel,
        status: "unsupported",
        safeReasonCode: "metricsUnsupported",
        safeMessage: metricsOutcome.safeMessage,
        failedMetricNames: metricsOutcome.failedMetrics.map((f) => f.metric),
        created,
        updated: !created,
      };
    }

    // Content metadata was still saved even though this hour's metrics
    // request failed — "one metrics request fails, content metadata may
    // still be stored."
    return {
      externalContentId: item.externalContentId,
      contentLabel,
      status: "partial",
      safeReasonCode: "metricsFailed",
      safeMessage: metricsOutcome.safeMessage,
      created,
      updated: !created,
    };
  }

  private async importInstagram(
    connection: PlatformConnection,
    limit: number,
  ): Promise<ConnectionResult> {
    const credential = await this.connectionService.getDecryptedCredential(connection.connectionId);
    if (!credential) {
      return connectionFailure(connection, "credentialUnavailable", "The Instagram credential is not available.");
    }
    const accessToken = credential.accessToken as string;
    const accountId = credential.accountId as string;

    let items: RecentContentItem[];
    try {
      items = await this.instagramConnector.fetchRecentContent(accessToken, accountId, limit);
    } catch (error) {
      return connectionFailureFromError(connection, error);
    }

    const outcomes = await mapWithConcurrency(items, ITEM_CONCURRENCY, (item) =>
      this.importOneItem(connection, item, () =>
        this.instagramConnector.fetchContentMetrics(
          accessToken,
          item.externalContentId,
          item.contentType,
          {
            likeCount: item.platformData.like_count as number | undefined,
            commentsCount: item.platformData.comments_count as number | undefined,
            rawAccountType: connection.accountType,
            providerMediaType: item.platformData.media_type as string | undefined,
            providerMediaProductType: item.platformData.media_product_type as string | undefined,
          },
        ),
      ),
    );

    // Account-level insights are fetched and persisted independently of
    // content import — a failure here (or the account request itself
    // failing entirely) must never fail the connection or block the
    // content items already imported above.
    await this.importInstagramAccountInsights(connection, accessToken, accountId);

    return buildConnectionResult(connection, outcomes);
  }

  private async importInstagramAccountInsights(
    connection: PlatformConnection,
    accessToken: string,
    accountId: string,
  ): Promise<void> {
    const snapshotHour = truncateToHourIso(this.now());
    let groups: Awaited<ReturnType<InstagramConnector["fetchAccountInsights"]>>;
    try {
      groups = await this.instagramConnector.fetchAccountInsights(
        accessToken,
        accountId,
        connection.accountType,
        snapshotHour,
      );
    } catch {
      // Never propagate — account insights are a separate, best-effort
      // addition to the content import that just happened.
      return;
    }

    for (const group of groups) {
      try {
        await this.accountPerformanceSnapshotRepository.upsertByHour({
          schemaVersion: "1.0.0",
          connectionId: connection.connectionId,
          platform: connection.platform,
          accountType: connection.accountType,
          snapshotHour,
          collectedAt: this.now(),
          period: group.period,
          since: group.since,
          until: group.until,
          timeframe: group.timeframe,
          breakdown: group.breakdown,
          completeness: group.completeness,
          metrics: group.metrics,
        });
      } catch {
        // One group's write failing must not stop the others.
        continue;
      }
    }
  }

  private async importFacebookPage(
    connection: PlatformConnection,
    limit: number,
  ): Promise<ConnectionResult> {
    const credential = await this.connectionService.getDecryptedCredential(connection.connectionId);
    if (!credential) {
      return connectionFailure(connection, "credentialUnavailable", "The Facebook Page credential is not available.");
    }
    const pageAccessToken = credential.accessToken as string;
    const pageId = connection.externalAccountId;
    if (!pageId) {
      return connectionFailure(connection, "pageIdMissing", "The connected Facebook Page is missing its identifier.");
    }

    let items: RecentContentItem[];
    try {
      items = await this.facebookConnector.fetchPageContent(pageAccessToken, pageId, limit);
    } catch (error) {
      return connectionFailureFromError(connection, error);
    }

    const outcomes = await mapWithConcurrency(items, ITEM_CONCURRENCY, (item) =>
      this.importOneItem(connection, item, () =>
        this.facebookConnector.fetchPagePostMetrics(
          pageAccessToken,
          item.externalContentId,
          item.contentType,
          item.platformData.provider_type as string | undefined,
        ),
      ),
    );

    // Page-level insights are fetched and persisted independently of
    // content import — a failure here must never fail the connection or
    // block the content items already imported above.
    await this.importFacebookPageInsights(connection, pageAccessToken, pageId);

    return buildConnectionResult(connection, outcomes);
  }

  private async importFacebookPageInsights(
    connection: PlatformConnection,
    pageAccessToken: string,
    pageId: string,
  ): Promise<void> {
    let result: Awaited<ReturnType<FacebookConnector["fetchPageInsights"]>>;
    try {
      result = await this.facebookConnector.fetchPageInsights(pageAccessToken, pageId);
    } catch {
      return;
    }

    try {
      await this.accountPerformanceSnapshotRepository.upsertByHour({
        schemaVersion: "1.0.0",
        connectionId: connection.connectionId,
        platform: connection.platform,
        accountType: connection.accountType,
        snapshotHour: truncateToHourIso(this.now()),
        collectedAt: this.now(),
        period: result.period,
        completeness: result.completeness,
        metrics: result.metrics,
      });
    } catch {
      // A write failure here must never fail the connection.
    }
  }

  private async importPinterest(
    connection: PlatformConnection,
    limit: number,
  ): Promise<ConnectionResult> {
    const credential = await this.connectionService.getDecryptedCredential(connection.connectionId);
    if (!credential) {
      return connectionFailure(connection, "credentialUnavailable", "The Pinterest credential is not available.");
    }
    const accessToken = credential.accessToken as string;

    let items: RecentContentItem[];
    try {
      items = await this.pinterestConnector.fetchRecentPins(accessToken, limit);
    } catch (error) {
      return connectionFailureFromError(connection, error);
    }

    const outcomes = await mapWithConcurrency(items, ITEM_CONCURRENCY, (item) =>
      this.importOneItem(connection, item, () =>
        this.pinterestConnector.fetchPinAnalytics(accessToken, item.externalContentId),
      ),
    );

    return buildConnectionResult(connection, outcomes);
  }

  // Facebook Account is never dispatched here — it is excluded upstream
  // by isEligibleDataImportSource (see runImport's eligibleConnections
  // filter). It is only an authorization identity used to discover
  // managed Pages: a live capability test (GET /me/posts) proved it
  // always returns zero posts without Advanced Access this app does not
  // have, so it can never be a real content source and must not appear
  // in connectionResults at all.
  private async importOneConnection(
    connection: PlatformConnection,
    limit: number,
  ): Promise<ConnectionResult> {
    if (connection.platform === "instagram") return this.importInstagram(connection, limit);
    if (connection.platform === "facebook" && connection.connectionTarget === "page") {
      return this.importFacebookPage(connection, limit);
    }
    if (connection.platform === "pinterest") return this.importPinterest(connection, limit);
    return connectionFailure(connection, "unknownConnectionType", "Unknown connection type.");
  }

  async runImport(): Promise<ImportRun> {
    const settings = await this.getSettings();
    const recentContentLimit = settings.recentContentLimit;
    const timestamp = this.now();

    const initialRun: ImportRun = {
      schemaVersion: "1.0.0",
      importRunId: `import_run_${randomUUID()}`,
      status: "running",
      startedAt: timestamp,
      recentContentLimit,
      totals: {
        connections: 0,
        requestedItems: 0,
        createdItems: 0,
        updatedItems: 0,
        failedItems: 0,
        skippedItems: 0,
      },
      connectionResults: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      await this.importRunRepository.createRunning(initialRun);
    } catch (error) {
      if (!(error instanceof RunningImportConflictError)) throw error;

      const running = await this.importRunRepository.findRunning();
      if (running && this.isStale(running)) {
        await this.importRunRepository.save({
          ...running,
          status: "failed",
          completedAt: this.now(),
          updatedAt: this.now(),
          safeErrorMessage:
            "This import run appears to have been interrupted (for example by a server restart) and was marked failed automatically.",
        });
        await this.importRunRepository.createRunning(initialRun);
      } else {
        throw new SafeServiceError("importAlreadyRunning", "An import is already running.");
      }
    }

    const eligibleConnections = (await this.connectionService.list()).filter((connection) =>
      isEligibleDataImportSource(connection),
    );

    const connectionResults = await mapWithConcurrency(
      eligibleConnections,
      CONNECTION_CONCURRENCY,
      (connection) => this.importOneConnection(connection, recentContentLimit),
    );

    const totals = {
      connections: connectionResults.length,
      requestedItems: connectionResults.reduce((sum, r) => sum + (r.requestedCount ?? 0), 0),
      createdItems: connectionResults.reduce((sum, r) => sum + (r.createdCount ?? 0), 0),
      updatedItems: connectionResults.reduce((sum, r) => sum + (r.updatedCount ?? 0), 0),
      failedItems: connectionResults.reduce((sum, r) => sum + (r.failedCount ?? 0), 0),
      skippedItems: connectionResults.reduce((sum, r) => sum + (r.skippedCount ?? 0), 0),
    };

    let status: ImportRun["status"];
    if (connectionResults.length === 0 || connectionResults.every((r) => r.status === "failed")) {
      status = "failed";
    } else if (connectionResults.every((r) => r.status === "success")) {
      status = "completed";
    } else {
      status = "completedWithErrors";
    }

    const finalRun: ImportRun = {
      ...initialRun,
      status,
      completedAt: this.now(),
      totals,
      connectionResults,
      updatedAt: this.now(),
    };
    await this.importRunRepository.save(finalRun);
    return finalRun;
  }
}
