import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";

// Display-only preference: which internalMetric names the user has
// chosen to hide from the performance table for one platform+contentType
// tab. Never affects data collection, stored values, completeness, or
// the metric capability registries — those are single-source-of-truth
// facts about what Meta actually returns, while this is purely "should
// the UI currently render this metric's column".
export interface MetricVisibilityPreference {
  schemaVersion: "1.0.0";
  platform: Platform;
  contentType: ContentType;
  hiddenMetrics: string[];
  createdAt: string;
  updatedAt: string;
}
