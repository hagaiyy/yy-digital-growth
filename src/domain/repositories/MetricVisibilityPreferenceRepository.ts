import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricVisibilityPreference } from "@/domain/models/MetricVisibilityPreference";

export interface MetricVisibilityPreferenceRepository {
  list(): Promise<MetricVisibilityPreference[]>;
  findByPlatformAndContentType(platform: Platform, contentType: ContentType): Promise<MetricVisibilityPreference | null>;
  save(platform: Platform, contentType: ContentType, hiddenMetrics: string[]): Promise<MetricVisibilityPreference>;
}
