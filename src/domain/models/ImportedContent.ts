import type { Platform } from "@/domain/models/PlatformConnection";

// "video" is kept only so already-imported Facebook content stored
// under the old classification still type-checks on read — Facebook's
// classifier no longer emits it, using "feedVideo" (shared with
// Instagram's own feed-video classification) instead. "textPost",
// "linkPost", and "album" are Facebook-specific.
export type ContentType =
  | "reel"
  | "story"
  | "imagePost"
  | "carousel"
  | "video"
  | "feedVideo"
  | "textPost"
  | "linkPost"
  | "album"
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
