import type { ContentType } from "@/domain/models/ImportedContent";

// One explicit function per platform — no generic rules engine. Any
// combination not recognized returns "unknown" rather than guessing.

export function mapInstagramContentType(
  mediaType: string | undefined,
  mediaProductType: string | undefined,
): ContentType {
  const type = mediaType?.toUpperCase();
  const productType = mediaProductType?.toUpperCase();

  if (productType === "REELS") return "reel";
  if (productType === "STORY") return "story";
  if (type === "CAROUSEL_ALBUM") return "carousel";
  if (type === "VIDEO") return "video";
  if (type === "IMAGE") return "imagePost";
  return "unknown";
}

export function mapFacebookContentType(
  isReel: boolean,
  attachmentType: string | undefined,
): ContentType {
  if (isReel) return "reel";
  const type = attachmentType?.toLowerCase();
  if (type === "video_inline" || type === "video_autoplay" || type === "video") return "video";
  if (type === "photo" || type === "album") return "imagePost";
  return "unknown";
}

export function mapPinterestContentType(mediaType: string | undefined): ContentType {
  const type = mediaType?.toLowerCase();
  if (type === "video") return "videoPin";
  if (type === "image") return "pin";
  return "unknown";
}
