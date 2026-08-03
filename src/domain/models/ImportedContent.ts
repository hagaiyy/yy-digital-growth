import type { Platform } from "@/domain/models/PlatformConnection";

// "video" is kept only so already-imported Facebook content stored
// under the old classification still type-checks on read — Facebook's
// classifier no longer emits it, using "feedVideo" (shared with
// Instagram's own feed-video classification) instead. "textPost",
// "linkPost", and "album" are Facebook-specific.
//
// "story" is kept only so already-imported rows written before the
// image/video Story split still type-check on read — the classifier no
// longer emits it, using "imageStory"/"videoStory"/"unknownStory"
// instead (image vs. video Stories have independent, separately-tested
// metric capabilities and must never share one proven/untested status).
// "story" doubles as the shared tab-group key the UI uses to display
// all three under one "Instagram — Stories" tab (see
// application/performance/storyGrouping.ts) — it is a real ContentType
// value precisely so no separate synthetic key is needed for that.
export type ContentType =
  | "reel"
  | "story"
  | "imageStory"
  | "videoStory"
  | "unknownStory"
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
