import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";

// This is a literal, hand-maintained data table — not a rules engine.
// Every entry is either (a) a real production response captured in this
// project's earlier live isolation testing (likes.summary/comments.summary
// rejected everywhere with OAuthException code=10 on the pre-read_insights
// token), or (b) a documented Meta candidate that has never been confirmed
// live with the new read_insights permission, marked "untested" until a
// real request proves otherwise. Nothing here is guessed into "available".
//
// `apiVersion` records the Graph API version this registry's findings are
// believed to correspond to (Meta's public Graph API Insights reference,
// consulted 2026-08-01, currently describes v26.0, and explicitly warns
// that "a number of Page Insights metrics" were deprecated as of
// 2026-06-15 — several of this app's previously-used metric names,
// including post_impressions, post_impressions_unique, and their
// page-level equivalents, are confirmed deprecated above v25). It is NOT
// a URL path segment: FacebookConnector's requests to
// graph.facebook.com/v19.0 stay pinned to the version already proven
// working; bumping the pinned version was not asked for by this task and
// risks a live regression this task did not need to take.
const API_VERSION_REFERENCE = "v26.0";
const LIVE_2026_08_01 = "2026-08-01";

export type RegistryScope = "post" | "page";
export type RegistryContentType = ContentType | "page";

export interface MetricCapabilityEntry {
  platform: "facebook";
  scope: RegistryScope;
  contentType: RegistryContentType;
  providerMetric: string;
  internalMetric: string;
  endpoint: string;
  requiredPermission: string;
  accessTier: "standard" | "advancedAccess";
  period?: string;
  nativeUnit: string;
  normalizedUnit?: string;
  status: MetricRecordStatus;
  apiVersion: string;
  lastVerifiedDate: string;
  safeLimitation?: string;
  requiresIndependentRequest?: boolean;
}

const POST_OBJECT_ENDPOINT = "/{post-id}";
const POST_INSIGHTS_ENDPOINT = "/{post-id}/insights";
const PAGE_INSIGHTS_ENDPOINT = "/{page-id}/insights";

function post(entry: {
  contentType: ContentType;
  providerMetric: string;
  internalMetric: string;
  nativeUnit: string;
  status: MetricRecordStatus;
  endpoint?: string;
  requiredPermission?: string;
  accessTier?: "standard" | "advancedAccess";
  period?: string;
  lastVerifiedDate?: string;
  safeLimitation?: string;
}): MetricCapabilityEntry {
  return {
    platform: "facebook",
    scope: "post",
    contentType: entry.contentType,
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: entry.endpoint ?? POST_INSIGHTS_ENDPOINT,
    requiredPermission: entry.requiredPermission ?? "read_insights",
    accessTier: entry.accessTier ?? "standard",
    period: entry.period ?? "lifetime",
    nativeUnit: entry.nativeUnit,
    status: entry.status,
    apiVersion: API_VERSION_REFERENCE,
    lastVerifiedDate: entry.lastVerifiedDate ?? LIVE_2026_08_01,
    safeLimitation: entry.safeLimitation,
  };
}

function page(entry: {
  providerMetric: string;
  internalMetric: string;
  nativeUnit: string;
  status: MetricRecordStatus;
  period?: string;
  safeLimitation?: string;
}): MetricCapabilityEntry {
  return {
    platform: "facebook",
    scope: "page",
    contentType: "page",
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: PAGE_INSIGHTS_ENDPOINT,
    requiredPermission: "read_insights",
    accessTier: "standard",
    period: entry.period ?? "day",
    nativeUnit: entry.nativeUnit,
    status: entry.status,
    apiVersion: API_VERSION_REFERENCE,
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: entry.safeLimitation,
  };
}

// Non-video content types share the same engagement/distribution metric
// surface — Meta does not document any capability difference between a
// text update, a link share, a photo, or an album at the post-insights
// level (unlike Instagram, where image vs. carousel genuinely differ).
const NON_VIDEO_CONTENT_TYPES: ContentType[] = ["textPost", "linkPost", "imagePost", "album"];
// Reel is never reliably distinguishable from an ordinary feed video via
// the /posts edge (see mapFacebookContentType) — the same video-metric
// candidates are attempted for both until real evidence proves a
// difference.
const VIDEO_CONTENT_TYPES: ContentType[] = ["feedVideo", "reel"];

function forEachContentType(
  contentTypes: ContentType[],
  build: (contentType: ContentType) => MetricCapabilityEntry,
): MetricCapabilityEntry[] {
  return contentTypes.map(build);
}

export const FACEBOOK_METRIC_CAPABILITY_REGISTRY: MetricCapabilityEntry[] = [
  // ---------------------------------------------------------------
  // Engagement counters — object fields, not /insights. Proven
  // rejected (OAuthException code=10) for likes/comments on the
  // pre-read_insights Page token; shares was proven merely empty
  // (never rejected). All three are re-tested live now that
  // read_insights is granted, since a permission appearing in
  // token-debug is not proof a field actually works.
  // ---------------------------------------------------------------
  ...forEachContentType([...NON_VIDEO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES], (contentType) =>
    post({
      contentType,
      providerMetric: "likes.summary(true)",
      internalMetric: "likes",
      nativeUnit: "count",
      status: "permissionRequired",
      endpoint: POST_OBJECT_ENDPOINT,
      requiredPermission: "pages_read_engagement",
      safeLimitation:
        "Live production response (imagePost/linkPost, 2026-08-01): still rejected (OAuthException code=10) even with read_insights and pages_read_engagement both granted — this field needs pages_read_user_content, which this task explicitly forbids requesting. Video content types were not directly tested (no video content available), but this is a permission check, not a content-type check, so the same rejection is expected to generalize.",
    }),
  ),
  ...forEachContentType([...NON_VIDEO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES], (contentType) =>
    post({
      contentType,
      providerMetric: "comments.summary(true)",
      internalMetric: "comments",
      nativeUnit: "count",
      status: "permissionRequired",
      endpoint: POST_OBJECT_ENDPOINT,
      requiredPermission: "pages_read_engagement",
      safeLimitation:
        "Live production response (imagePost/linkPost, 2026-08-01): still rejected (OAuthException code=10) even with read_insights and pages_read_engagement both granted — needs pages_read_user_content, which this task explicitly forbids requesting.",
    }),
  ),
  ...forEachContentType([...NON_VIDEO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES], (contentType) =>
    post({
      contentType,
      providerMetric: "shares",
      internalMetric: "shares",
      nativeUnit: "count",
      status: "empty",
      endpoint: POST_OBJECT_ENDPOINT,
      requiredPermission: "pages_read_engagement",
      safeLimitation:
        "Live production response (imagePost/linkPost, 2026-08-01): field accepted, no error, but no value returned for either tested post — Meta likely omits this field entirely for a post with zero shares rather than returning a literal 0; never converted to a fabricated zero.",
    }),
  ),

  // ---------------------------------------------------------------
  // Distribution & performance — non-video content types.
  // ---------------------------------------------------------------
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_impressions",
      internalMetric: "impressions",
      nativeUnit: "count",
      status: "deprecated",
      safeLimitation: "Confirmed deprecated above Graph API v25 in current Meta documentation (v26.0).",
    }),
  ),
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_impressions_unique",
      internalMetric: "reach",
      nativeUnit: "count",
      status: "deprecated",
      safeLimitation:
        "Confirmed deprecated above Graph API v25 — this was the closest documented equivalent to post-level 'reach'; Meta's current documentation shows no non-deprecated post-level reach replacement.",
    }),
  ),
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_media_view",
      internalMetric: "views",
      nativeUnit: "count",
      status: "available",
      safeLimitation: "Live production response (imagePost/linkPost, 2026-08-01): confirmed supported with real values (0 and 5) — Meta's documented successor to the deprecated impressions family.",
    }),
  ),
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_engaged_users",
      internalMetric: "engagedUsers",
      nativeUnit: "count",
      status: "empty",
      safeLimitation: "Live production response (imagePost/linkPost, 2026-08-01): field accepted, no error, but no value returned for either tested post. Not found in current v26.0 post-metrics documentation — may be a legacy name Meta still accepts but rarely populates.",
    }),
  ),
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_clicks",
      internalMetric: "clicks",
      nativeUnit: "count",
      status: "available",
      safeLimitation: "Live production response (imagePost/linkPost, 2026-08-01): confirmed supported (value 0 for both tested posts).",
    }),
  ),
  ...forEachContentType(NON_VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_reactions_like_total",
      internalMetric: "reactionsLikeTotal",
      nativeUnit: "count",
      status: "available",
      safeLimitation: "Live production response (imagePost/linkPost, 2026-08-01): confirmed supported via /insights (value 0 for both tested posts) even though the likes.summary object field is rejected — the two use different endpoints and permission requirements.",
    }),
  ),

  // ---------------------------------------------------------------
  // Video / Reel — distribution, video views, and watch-time metrics.
  // Never sent to a non-video post.
  // ---------------------------------------------------------------
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_impressions",
      internalMetric: "impressions",
      nativeUnit: "count",
      status: "deprecated",
      safeLimitation: "Confirmed deprecated above Graph API v25 in current Meta documentation (v26.0).",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_impressions_unique",
      internalMetric: "reach",
      nativeUnit: "count",
      status: "deprecated",
      safeLimitation: "Confirmed deprecated above Graph API v25.",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_video_views",
      internalMetric: "videoViews",
      nativeUnit: "count",
      status: "untested",
      safeLimitation: "Documented as still active (not deprecated) in current Meta documentation (v26.0).",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_video_views_unique",
      internalMetric: "videoViewsUnique",
      nativeUnit: "count",
      status: "deprecated",
      safeLimitation: "Confirmed deprecated above Graph API v25.",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_video_avg_time_watched",
      internalMetric: "averageWatchTimeMs",
      nativeUnit: "milliseconds",
      status: "untested",
      safeLimitation: "Documented as active in current Meta documentation (v26.0); native unit not yet confirmed live — Instagram's equivalent watch-time metrics were found to already be in milliseconds despite an initial untested assumption of seconds.",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_video_view_time",
      internalMetric: "totalWatchTimeMs",
      nativeUnit: "milliseconds",
      status: "untested",
      safeLimitation: "Documented as active (day and lifetime periods) in current Meta documentation (v26.0); covers both this task's 'minutes viewed' and 'total watch time' candidates, which map to the same Meta metric.",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_video_complete_views_30s",
      internalMetric: "completeViews30s",
      nativeUnit: "count",
      status: "untested",
      safeLimitation: "Documented as active in current Meta documentation (v26.0); this task's '3-second video views' candidate has no current, non-deprecated Meta metric name found in documentation — Meta's own deprecation notes describe 3-second view metrics as superseded by Media Views (post_media_view), included separately below.",
    }),
  ),
  ...forEachContentType(VIDEO_CONTENT_TYPES, (contentType) =>
    post({
      contentType,
      providerMetric: "post_media_view",
      internalMetric: "views",
      nativeUnit: "count",
      status: "untested",
      safeLimitation: "Meta's documented successor to the deprecated 3-second-view and impressions metrics for media content.",
    }),
  ),

  // ---------------------------------------------------------------
  // Page-level — never mixed into a post-level snapshot. Every
  // candidate is untested until a real production response.
  // ---------------------------------------------------------------
  page({
    providerMetric: "page_impressions",
    internalMetric: "impressions",
    nativeUnit: "count",
    status: "empty",
    safeLimitation: "Live production response (2026-08-01): field accepted, no error, but no value returned. Meta documents several Page insights metrics as requiring 100+ Page likes; this Page's follower count has not been independently confirmed against that threshold.",
  }),
  page({
    providerMetric: "page_impressions_unique",
    internalMetric: "reach",
    nativeUnit: "count",
    status: "deprecated",
    safeLimitation: "Confirmed deprecated above Graph API v25 in current Meta documentation (v26.0).",
  }),
  page({
    providerMetric: "page_post_engagements",
    internalMetric: "postEngagements",
    nativeUnit: "count",
    status: "available",
    safeLimitation: "Live production response (2026-08-01): confirmed supported (value 0).",
  }),
  page({
    providerMetric: "page_video_views",
    internalMetric: "videoViews",
    nativeUnit: "count",
    status: "available",
    safeLimitation: "Live production response (2026-08-01): confirmed supported (value 0) — this Page had no video posts in the tested window.",
  }),
  page({
    providerMetric: "page_video_views_unique",
    internalMetric: "videoViewsUnique",
    nativeUnit: "count",
    status: "deprecated",
    safeLimitation: "Confirmed deprecated above Graph API v25.",
  }),
  page({
    providerMetric: "page_fans",
    internalMetric: "fans",
    nativeUnit: "count",
    status: "empty",
    safeLimitation: "Live production response (2026-08-01): field accepted, no error, but no value returned.",
  }),
  page({
    providerMetric: "page_fan_adds_unique",
    internalMetric: "fanAddsUnique",
    nativeUnit: "count",
    status: "empty",
    safeLimitation: "Live production response (2026-08-01): field accepted, no error, but no value returned.",
  }),
  page({
    providerMetric: "page_fan_removes_unique",
    internalMetric: "fanRemovesUnique",
    nativeUnit: "count",
    status: "empty",
    safeLimitation: "Live production response (2026-08-01): field accepted, no error, but no value returned.",
  }),
  page({
    providerMetric: "page_views_total",
    internalMetric: "pageViewsTotal",
    nativeUnit: "count",
    status: "available",
    safeLimitation: "Live production response (2026-08-01): confirmed supported (value 0).",
  }),
  page({
    providerMetric: "page_posts_impressions",
    internalMetric: "postsImpressions",
    nativeUnit: "count",
    status: "empty",
    safeLimitation: "Live production response (2026-08-01): field accepted, no error, but no value returned. Aggregate impressions across all of the Page's posts for the period — distinct from any single post's own impressions.",
  }),
  page({
    providerMetric: "page_total_media_view_unique",
    internalMetric: "totalMediaViewUnique",
    nativeUnit: "count",
    status: "available",
    safeLimitation: "Live production response (2026-08-01): confirmed supported (value 0) — Meta's documented replacement direction for several deprecated unique-reach/impression metrics.",
  }),
];
