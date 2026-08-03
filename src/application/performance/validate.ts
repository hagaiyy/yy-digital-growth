import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";

const PLATFORMS: Platform[] = ["instagram", "facebook", "pinterest"];
const CONTENT_TYPES: ContentType[] = [
  "reel",
  "story",
  "imageStory",
  "videoStory",
  "unknownStory",
  "imagePost",
  "carousel",
  "video",
  "feedVideo",
  "textPost",
  "linkPost",
  "album",
  "pin",
  "videoPin",
  "unknown",
];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && PLATFORMS.includes(value as Platform);
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && CONTENT_TYPES.includes(value as ContentType);
}
