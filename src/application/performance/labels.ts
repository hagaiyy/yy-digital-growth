import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  reel: "Reels",
  story: "Stories",
  imagePost: "Images",
  carousel: "Carousels",
  video: "Videos",
  feedVideo: "Videos",
  textPost: "Text Posts",
  linkPost: "Link Posts",
  album: "Albums",
  pin: "Pins",
  videoPin: "Video Pins",
  unknown: "Other",
};

// Facebook's "imagePost" tab is labeled "Image Posts" (matching this
// feature's own worked examples) while Instagram keeps the shorter
// "Images" — both read from the one shared ContentType, so the override
// lives here rather than forking the enum.
const CONTENT_TYPE_LABEL_OVERRIDES: Partial<Record<Platform, Partial<Record<ContentType, string>>>> = {
  facebook: { imagePost: "Image Posts" },
};

export function contentTypeLabel(platform: Platform, contentType: ContentType): string {
  return CONTENT_TYPE_LABEL_OVERRIDES[platform]?.[contentType] ?? CONTENT_TYPE_LABELS[contentType];
}

export function tabLabel(platform: Platform, contentType: ContentType): string {
  return `${PLATFORM_LABELS[platform]} — ${contentTypeLabel(platform, contentType)}`;
}

const PLATFORM_ORDER: Platform[] = ["instagram", "facebook", "pinterest"];
const CONTENT_TYPE_ORDER: ContentType[] = [
  "reel",
  "carousel",
  "imagePost",
  "story",
  "feedVideo",
  "video",
  "linkPost",
  "textPost",
  "album",
  "pin",
  "videoPin",
  "unknown",
];

// Stable tab ordering: platforms grouped in a fixed priority order, and
// content types within a platform in a fixed priority order — never
// alphabetical, so tabs don't reshuffle as new content types appear.
export function tabSortKey(platform: Platform, contentType: ContentType): [number, number] {
  const platformIndex = PLATFORM_ORDER.indexOf(platform);
  const contentTypeIndex = CONTENT_TYPE_ORDER.indexOf(contentType);
  return [
    platformIndex === -1 ? PLATFORM_ORDER.length : platformIndex,
    contentTypeIndex === -1 ? CONTENT_TYPE_ORDER.length : contentTypeIndex,
  ];
}

export function humanizeInternalMetricName(internalMetric: string): string {
  const spaced = internalMetric.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const NATIVE_UNIT_SUFFIX: Record<string, string> = {
  milliseconds: "ms",
  percentage: "%",
};
