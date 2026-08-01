import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";

import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { Platform } from "@/domain/models/PlatformConnection";
import type {
  ImportedContentRepository,
  UpsertImportedContentInput,
  UpsertImportedContentResult,
} from "@/domain/repositories/ImportedContentRepository";

export class MongoImportedContentRepository implements ImportedContentRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<ImportedContent>("importedContents");
  }

  async list(): Promise<ImportedContent[]> {
    return this.collection.find({}, { projection: { _id: 0 } }).sort({ publishedAt: -1 }).toArray();
  }

  async findById(importedContentId: string): Promise<ImportedContent | null> {
    return this.collection.findOne({ importedContentId }, { projection: { _id: 0 } });
  }

  async findByPlatformAndExternalId(
    platform: Platform,
    externalContentId: string,
  ): Promise<ImportedContent | null> {
    return this.collection.findOne({ platform, externalContentId }, { projection: { _id: 0 } });
  }

  async upsertByIdentity(input: UpsertImportedContentInput): Promise<UpsertImportedContentResult> {
    const now = new Date().toISOString();
    const newId = `imported_content_${randomUUID()}`;

    const record = await this.collection.findOneAndUpdate(
      { platform: input.platform, externalContentId: input.externalContentId },
      {
        $set: {
          schemaVersion: "1.0.0",
          connectionId: input.connectionId,
          platform: input.platform,
          externalContentId: input.externalContentId,
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
        },
        $setOnInsert: {
          importedContentId: newId,
          firstImportedAt: now,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after", projection: { _id: 0 } },
    );

    if (!record) {
      throw new Error("Failed to upsert importedContent record.");
    }

    // firstImportedAt equals `now` only when $setOnInsert just fired —
    // i.e. this call created the record rather than updating one.
    return { record, created: record.firstImportedAt === now };
  }
}
