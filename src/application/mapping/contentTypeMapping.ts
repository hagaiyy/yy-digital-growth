import type { ContentType } from "@/domain/models/ImportedContent";

// One explicit function per platform — no generic rules engine. Any
// combination not recognized returns "unknown" rather than guessing.

// Classification always uses both provider fields together — never
// media_type alone. media_product_type is Meta's own signal for how a
// VIDEO is actually surfaced (REELS vs FEED vs STORY); a VIDEO whose
// product type is not REELS or STORY is a plain feed video (feedVideo),
// never guessed as a Reel just because its media_type is VIDEO.
export function mapInstagramContentType(
  mediaType: string | undefined,
  mediaProductType: string | undefined,
): ContentType {
  const type = mediaType?.toUpperCase();
  const productType = mediaProductType?.toUpperCase();

  if (productType === "REELS") return "reel";
  // Image and video Stories have independent, separately-tested metric
  // capabilities (Meta's own Story insights documentation names no
  // video-specific metric the way Reels do, but per this app's own
  // rule that must be proven live, not assumed from the docs being
  // silent) — classification always uses the real media_type, never
  // an assumption that Stories are always one or the other.
  if (productType === "STORY") {
    if (type === "IMAGE") return "imageStory";
    if (type === "VIDEO") return "videoStory";
    return "unknownStory";
  }
  if (type === "CAROUSEL_ALBUM") return "carousel";
  if (type === "VIDEO") return "feedVideo";
  if (type === "IMAGE") return "imagePost";
  return "unknown";
}

// Facebook's /posts edge has no explicit, documented field that
// distinguishes a Reel from an ordinary feed video the way Instagram's
// media_product_type does — this classifier therefore never guesses
// "reel"; every video attachment becomes "feedVideo" until a real Reel
// is observed on this Page and a genuine distinguishing provider field
// is confirmed live. Preserving `providerType`/`statusType` alongside
// the classification (see FacebookConnector.fetchPageContent) means
// that evidence, once found, doesn't require re-importing anything.
export function mapFacebookContentType(
  attachmentType: string | undefined,
  attachmentMediaType: string | undefined,
  providerType: string | undefined,
  statusType: string | undefined,
): ContentType {
  const type = attachmentType?.toLowerCase();
  const mediaType = attachmentMediaType?.toLowerCase();
  const legacyType = providerType?.toLowerCase();
  const legacyStatusType = statusType?.toLowerCase();

  if (type === "album") return "album";
  if (
    mediaType === "video" ||
    type === "video_inline" ||
    type === "video_autoplay" ||
    type === "video_direct_response" ||
    legacyType === "video"
  ) {
    return "feedVideo";
  }
  if (type === "share" || type === "native_templates" || mediaType === "link" || legacyType === "link") {
    return "linkPost";
  }
  if (type === "photo" || mediaType === "photo" || legacyType === "photo") return "imagePost";
  if (
    legacyType === "status" ||
    legacyStatusType === "mobile_status_update" ||
    legacyStatusType === "created_note" ||
    legacyStatusType === "shared_story"
  ) {
    return "textPost";
  }
  return "unknown";
}

export function mapPinterestContentType(mediaType: string | undefined): ContentType {
  const type = mediaType?.toLowerCase();
  if (type === "video") return "videoPin";
  if (type === "image") return "pin";
  return "unknown";
}
