import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { Platform } from "@/domain/models/PlatformConnection";

export type UpsertImportedContentInput = Omit<
  ImportedContent,
  "importedContentId" | "firstImportedAt" | "lastImportedAt" | "createdAt" | "updatedAt"
>;

export interface UpsertImportedContentResult {
  record: ImportedContent;
  created: boolean;
}

export interface ImportedContentRepository {
  list(): Promise<ImportedContent[]>;
  findById(importedContentId: string): Promise<ImportedContent | null>;
  findByPlatformAndExternalId(
    platform: Platform,
    externalContentId: string,
  ): Promise<ImportedContent | null>;
  upsertByIdentity(input: UpsertImportedContentInput): Promise<UpsertImportedContentResult>;
}
