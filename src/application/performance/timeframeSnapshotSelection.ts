import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";

export type TimeframeKey = "first4Hours" | "firstDay" | "firstWeek" | "latest";

export const TIMEFRAME_KEYS: TimeframeKey[] = ["first4Hours", "firstDay", "firstWeek", "latest"];

export const TIMEFRAME_LABELS: Record<TimeframeKey, string> = {
  first4Hours: "First 4 hours",
  firstDay: "First day",
  firstWeek: "First week",
  latest: "Latest",
};

const WINDOW_MS: Record<Exclude<TimeframeKey, "latest">, number> = {
  first4Hours: 4 * 60 * 60 * 1000,
  firstDay: 24 * 60 * 60 * 1000,
  firstWeek: 7 * 24 * 60 * 60 * 1000,
};

// Deterministic snapshot-selection rule (documented here, exercised by
// tests in tests/application/timeframeSnapshotSelection.test.ts):
//
// - "latest" always resolves to the snapshot with the greatest
//   `collectedAt` across all persisted snapshots for the content item,
//   regardless of the item's publish date. This is the newest real data
//   point that exists, full stop.
//
// - "first4Hours" / "firstDay" / "firstWeek" each define a window
//   [publishedAt, publishedAt + windowDuration]. Among the snapshots
//   whose `collectedAt` falls inside that window (inclusive of both
//   ends), the one with the GREATEST `collectedAt` is selected — i.e.
//   the most mature/complete data point that is still within the
//   window, not the earliest one. This favors accuracy (more time for
//   the platform to report engagement) over strict recency-from-publish.
//
// - If no persisted snapshot falls inside a timeframe's window (or
//   `publishedAt` is missing/invalid), that timeframe has no snapshot.
//   Nothing is invented, interpolated, or borrowed from an adjacent
//   timeframe — callers must render "No data saved for timeframe".
export function selectTimeframeSnapshot(
  snapshots: PerformanceSnapshot[],
  publishedAt: string | null | undefined,
  timeframe: TimeframeKey,
): PerformanceSnapshot | null {
  if (snapshots.length === 0) return null;

  if (timeframe === "latest") {
    return snapshots.reduce((latest, candidate) =>
      new Date(candidate.collectedAt).getTime() > new Date(latest.collectedAt).getTime() ? candidate : latest,
    );
  }

  if (!publishedAt) return null;
  const publishedMs = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedMs)) return null;

  const windowEndMs = publishedMs + WINDOW_MS[timeframe];
  let best: PerformanceSnapshot | null = null;
  let bestMs = -Infinity;
  for (const snapshot of snapshots) {
    const collectedMs = new Date(snapshot.collectedAt).getTime();
    if (Number.isNaN(collectedMs)) continue;
    if (collectedMs < publishedMs || collectedMs > windowEndMs) continue;
    if (collectedMs > bestMs) {
      best = snapshot;
      bestMs = collectedMs;
    }
  }
  return best;
}

export function selectAllTimeframeSnapshots(
  snapshots: PerformanceSnapshot[],
  publishedAt: string | null | undefined,
): Record<TimeframeKey, PerformanceSnapshot | null> {
  return {
    first4Hours: selectTimeframeSnapshot(snapshots, publishedAt, "first4Hours"),
    firstDay: selectTimeframeSnapshot(snapshots, publishedAt, "firstDay"),
    firstWeek: selectTimeframeSnapshot(snapshots, publishedAt, "firstWeek"),
    latest: selectTimeframeSnapshot(snapshots, publishedAt, "latest"),
  };
}
