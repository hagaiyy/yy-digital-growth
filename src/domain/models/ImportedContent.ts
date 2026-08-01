import type { Platform } from "@/domain/models/PlatformConnection";

// "video" remains Facebook's generic feed-video classification (see
// mapFacebookContentType) — "feedVideo" is Instagram-specific, added so
// an Instagram feed VIDEO (not a Reel, not a Story) has its own metric
// map instead of silently sharing Facebook's.
export type ContentType =
  | "reel"
  | "story"
  | "imagePost"
  | "carousel"
  | "video"
  | "feedVideo"
  | "pin"
  | "videoPin"
  | "unknown";

export type ImportedContentStatus = "active" | "unavailable" | "archived";

export interface ImportedContent {
  schemaVersion: "1.0.0";
  importedContentId: string;
  connectionId: string;
  platform: Platform;
  externalContentId: string;
  contentType: ContentType;
  status: ImportedContentStatus;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[];
  permalink?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  platformData?: Record<string, unknown>;
  firstImportedAt: string;
  lastImportedAt: string;
  createdAt: string;
  updatedAt: string;
}
