import type { ContentType } from "@/domain/models/ImportedContent";

// Image and video Stories are independent ContentType values (separate,
// independently-tested metric capabilities — see
// instagram/metricCapabilityRegistry.ts) but share one user-facing
// "Instagram — Stories" tab. "story" is the real ContentType value that
// doubles as that tab's group key (and as the classification any Story
// imported before this split still carries on read).
export const STORY_CONTENT_TYPES: ContentType[] = ["imageStory", "videoStory", "unknownStory", "story"];

// The tab/table-visibility-preference identity for a given contentType —
// identical to the contentType itself for everything except the three
// Story sub-types, which all collapse to "story".
export function tabGroupFor(contentType: ContentType): ContentType {
  return STORY_CONTENT_TYPES.includes(contentType) ? "story" : contentType;
}

// The real ContentType values a tab group actually contains. Every
// group is just itself, except "story", which expands to every Story
// sub-type so a single "Stories" tab shows image and video Stories
// (and any legacy pre-split row) together.
export function contentTypesInGroup(group: ContentType): ContentType[] {
  return group === "story" ? STORY_CONTENT_TYPES : [group];
}
