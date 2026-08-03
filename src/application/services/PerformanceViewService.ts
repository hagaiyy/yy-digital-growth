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
import { contentTypesInGroup, tabGroupFor } from "@/application/performance/storyGrouping";

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
  // Metric-specific human-readable explanation for a non-value-bearing
  // status (e.g. why "plays" has no value when "views" does). A live
  // MetricRecord's own safeReasonMessage always wins; falls back to the
  // registry's safeLimitation note when no live record exists yet.
  reason?: string;
}

export interface TableTimeframeCell {
  hasSnapshot: boolean;
  collectedAt: string | null;
  metrics: TableMetricCell[];
}

export interface TableRow {
  importedContentId: string;
  // The row's own real content type — distinct from the tab's group
  // key. Every row in an ordinary tab shares this with the tab itself;
  // rows in the "Instagram — Stories" tab can each be "imageStory" or
  // "videoStory" (or the legacy "unknownStory"/"story"), which is why
  // this is carried per row rather than assumed from the tab.
  contentType: ContentType;
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
        reason: record.safeReasonMessage ?? relevant.reason,
      };
    }
    return {
      internalMetric: relevant.internalMetric,
      nativeUnit: relevant.nativeUnit,
      normalizedUnit: relevant.normalizedUnit,
      value: null,
      status: relevant.canonicalStatus,
      reason: relevant.reason,
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
      // Image and video Stories collapse to one "story" tab group —
      // every other content type is its own group.
      const group = tabGroupFor(item.contentType);
      const key = `${item.platform}:${group}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { platform: item.platform, contentType: group, count: 1 });
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

  // `group` is a tab identity (e.g. "story"), not necessarily one real
  // content type — contentTypesInGroup expands it to every real
  // ContentType the tab actually contains. Each row still uses ONLY its
  // own real content type's relevant-metric list when building cells,
  // so an image Story row is never filled in with video Story evidence
  // (or vice versa) — the union below exists solely to give the tab's
  // hide/show toolbar the full set of metrics either sub-type can show.
  async getTable(platform: Platform, group: ContentType): Promise<PerformanceTableData> {
    const constituentTypes = contentTypesInGroup(group);

    const unionByInternalMetric = new Map<string, RelevantMetric>();
    for (const contentType of constituentTypes) {
      for (const metric of getRelevantMetricsForContentType(platform, contentType)) {
        if (!unionByInternalMetric.has(metric.internalMetric)) {
          unionByInternalMetric.set(metric.internalMetric, metric);
        }
      }
    }
    const relevantMetrics = [...unionByInternalMetric.values()];

    const items = (await this.deps.importedContentRepository.list()).filter(
      (item) => item.platform === platform && constituentTypes.includes(item.contentType),
    );

    const rows = await Promise.all(
      items.map(async (item): Promise<TableRow> => {
        const rowRelevantMetrics = getRelevantMetricsForContentType(platform, item.contentType);
        const snapshots = await this.deps.performanceSnapshotRepository.findByImportedContentId(item.importedContentId);
        const selected = selectAllTimeframeSnapshots(snapshots, item.publishedAt);
        const timeframes = {} as Record<TimeframeKey, TableTimeframeCell>;
        for (const key of TIMEFRAME_KEYS) {
          const snapshot = selected[key];
          timeframes[key] = snapshot
            ? { hasSnapshot: true, collectedAt: snapshot.collectedAt, metrics: buildMetricCells(snapshot, rowRelevantMetrics) }
            : { hasSnapshot: false, collectedAt: null, metrics: [] };
        }
        return {
          importedContentId: item.importedContentId,
          contentType: item.contentType,
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
