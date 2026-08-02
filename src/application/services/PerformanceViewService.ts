import type { ImportedContentRepository } from "@/domain/repositories/ImportedContentRepository";
import type { PerformanceSnapshotRepository } from "@/domain/repositories/PerformanceSnapshotRepository";
import type { MetricVisibilityPreferenceRepository } from "@/domain/repositories/MetricVisibilityPreferenceRepository";
import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus, PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import { getRelevantMetricsForContentType, type RelevantMetric } from "@/application/performance/relevantMetrics";
import {
  selectAllTimeframeSnapshots,
  TIMEFRAME_KEYS,
  type TimeframeKey,
} from "@/application/performance/timeframeSnapshotSelection";
import { tabLabel, tabSortKey } from "@/application/performance/labels";

export interface PerformanceTabSummary {
  platform: Platform;
  contentType: ContentType;
  label: string;
  itemCount: number;
}

export interface TableMetricCell {
  internalMetric: string;
  nativeUnit: string;
  normalizedUnit?: string;
  value: number | string | null;
  status: MetricRecordStatus;
}

export interface TableTimeframeCell {
  hasSnapshot: boolean;
  collectedAt: string | null;
  metrics: TableMetricCell[];
}

export interface TableRow {
  importedContentId: string;
  thumbnailUrl: string | null;
  caption: string | null;
  title: string | null;
  permalink: string | null;
  publishedAt: string | null;
  timeframes: Record<TimeframeKey, TableTimeframeCell>;
}

export interface PerformanceTableData {
  relevantMetrics: RelevantMetric[];
  rows: TableRow[];
}

// Builds each timeframe cell's metric list from the relevant-metric set
// for the platform+contentType. When the selected snapshot actually
// recorded a given metric, its live value/status is used. When it
// didn't (the metric was simply never part of that request — e.g. a
// video-only metric on an older snapshot), the registry's own canonical
// status is shown instead of a blank cell or a fabricated zero.
function buildMetricCells(snapshot: PerformanceSnapshot, relevantMetrics: RelevantMetric[]): TableMetricCell[] {
  const recordsByInternalMetric = new Map((snapshot.metricRecords ?? []).map((record) => [record.internalMetric, record]));
  return relevantMetrics.map((relevant) => {
    const record = recordsByInternalMetric.get(relevant.internalMetric);
    if (record) {
      return {
        internalMetric: relevant.internalMetric,
        nativeUnit: record.nativeUnit,
        normalizedUnit: record.normalizedUnit,
        value: record.value,
        status: record.status,
      };
    }
    return {
      internalMetric: relevant.internalMetric,
      nativeUnit: relevant.nativeUnit,
      normalizedUnit: relevant.normalizedUnit,
      value: null,
      status: relevant.canonicalStatus,
    };
  });
}

// Read-only view over already-imported content and already-collected
// snapshots, plus the small display-only metric-visibility preference.
// Never touches import/collection logic, connectors, or the metric
// capability registries' own status values — those stay exactly as the
// Instagram/Facebook import pipelines produced them.
export class PerformanceViewService {
  constructor(
    private readonly deps: {
      importedContentRepository: ImportedContentRepository;
      performanceSnapshotRepository: PerformanceSnapshotRepository;
      metricVisibilityPreferenceRepository: MetricVisibilityPreferenceRepository;
    },
  ) {}

  async listTabs(): Promise<PerformanceTabSummary[]> {
    const items = await this.deps.importedContentRepository.list();
    const counts = new Map<string, { platform: Platform; contentType: ContentType; count: number }>();
    for (const item of items) {
      const key = `${item.platform}:${item.contentType}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { platform: item.platform, contentType: item.contentType, count: 1 });
    }
    return [...counts.values()]
      .map(({ platform, contentType, count }) => ({
        platform,
        contentType,
        label: tabLabel(platform, contentType),
        itemCount: count,
      }))
      .sort((a, b) => {
        const [platformA, contentTypeA] = tabSortKey(a.platform, a.contentType);
        const [platformB, contentTypeB] = tabSortKey(b.platform, b.contentType);
        return platformA - platformB || contentTypeA - contentTypeB;
      });
  }

  async getTable(platform: Platform, contentType: ContentType): Promise<PerformanceTableData> {
    const relevantMetrics = getRelevantMetricsForContentType(platform, contentType);
    const items = (await this.deps.importedContentRepository.list()).filter(
      (item) => item.platform === platform && item.contentType === contentType,
    );

    const rows = await Promise.all(
      items.map(async (item): Promise<TableRow> => {
        const snapshots = await this.deps.performanceSnapshotRepository.findByImportedContentId(item.importedContentId);
        const selected = selectAllTimeframeSnapshots(snapshots, item.publishedAt);
        const timeframes = {} as Record<TimeframeKey, TableTimeframeCell>;
        for (const key of TIMEFRAME_KEYS) {
          const snapshot = selected[key];
          timeframes[key] = snapshot
            ? { hasSnapshot: true, collectedAt: snapshot.collectedAt, metrics: buildMetricCells(snapshot, relevantMetrics) }
            : { hasSnapshot: false, collectedAt: null, metrics: [] };
        }
        return {
          importedContentId: item.importedContentId,
          thumbnailUrl: item.thumbnailUrl ?? null,
          caption: item.caption ?? null,
          title: item.title ?? null,
          permalink: item.permalink ?? null,
          publishedAt: item.publishedAt ?? null,
          timeframes,
        };
      }),
    );

    return { relevantMetrics, rows };
  }

  async getHiddenMetrics(platform: Platform, contentType: ContentType): Promise<string[]> {
    const preference = await this.deps.metricVisibilityPreferenceRepository.findByPlatformAndContentType(
      platform,
      contentType,
    );
    return preference?.hiddenMetrics ?? [];
  }

  async setHiddenMetrics(platform: Platform, contentType: ContentType, hiddenMetrics: string[]): Promise<string[]> {
    const saved = await this.deps.metricVisibilityPreferenceRepository.save(platform, contentType, hiddenMetrics);
    return saved.hiddenMetrics;
  }
}
