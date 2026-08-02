import type { Db } from "mongodb";

import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricVisibilityPreference } from "@/domain/models/MetricVisibilityPreference";
import type { MetricVisibilityPreferenceRepository } from "@/domain/repositories/MetricVisibilityPreferenceRepository";

export class MongoMetricVisibilityPreferenceRepository implements MetricVisibilityPreferenceRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<MetricVisibilityPreference>("metricVisibilityPreferences");
  }

  async list(): Promise<MetricVisibilityPreference[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).toArray();
  }

  async findByPlatformAndContentType(
    platform: Platform,
    contentType: ContentType,
  ): Promise<MetricVisibilityPreference | null> {
    return this.collection.findOne({ platform, contentType }, { projection: { _id: 0 } });
  }

  async save(platform: Platform, contentType: ContentType, hiddenMetrics: string[]): Promise<MetricVisibilityPreference> {
    const now = new Date().toISOString();
    const record = await this.collection.findOneAndUpdate(
      { platform, contentType },
      {
        $set: { hiddenMetrics, updatedAt: now },
        $setOnInsert: { schemaVersion: "1.0.0", platform, contentType, createdAt: now },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } },
    );
    if (!record) {
      throw new Error("Failed to upsert metricVisibilityPreference record.");
    }
    return record;
  }
}
