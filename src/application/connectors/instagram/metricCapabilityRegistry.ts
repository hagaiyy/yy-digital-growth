import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import type { NormalizedInstagramAccountType } from "./accountType";

// This is a literal, hand-maintained data table — not a rules engine.
// Every entry is either (a) a real production response captured earlier
// in this project's diagnostics/live-acceptance runs, or (b) a
// documented Meta candidate that has never been confirmed live, marked
// "untested" until a real request proves otherwise. Nothing here is
// guessed into "supported".
//
// `apiVersion` records the Graph API version this registry's findings
// are believed to correspond to (Meta's public Instagram Platform docs,
// consulted 2026-08-01, currently describe v25.0) — it is NOT a URL
// path segment. InstagramConnector's requests to graph.instagram.com
// deliberately stay unversioned, matching its already-proven-working
// behavior; pinning a version was not asked for and risks a live
// regression this task did not need to take.
const API_VERSION_REFERENCE = "v25.0";

export type RegistryScope = "media" | "account";
export type RegistryAccountType = NormalizedInstagramAccountType | "any";
export type RegistryContentType = ContentType | "account";

export interface MetricCapabilityEntry {
  platform: "instagram";
  scope: RegistryScope;
  accountType: RegistryAccountType;
  contentType: RegistryContentType;
  providerMetric: string;
  internalMetric: string;
  endpoint: string;
  requiredPermissions: string[];
  period?: string;
  breakdown?: string;
  timeframe?: string;
  nativeUnit: string;
  normalizedUnit?: string;
  status: MetricRecordStatus;
  apiVersion: string;
  lastVerifiedDate: string;
  safeLimitation?: string;
  // Set only once live evidence proves a metric must be requested on
  // its own — e.g. because it needs a different parameter shape than
  // the rest of its group, not merely because it might be rejected
  // (rejection is already handled by combined-first/bisect-on-failure).
  requiresIndependentRequest?: boolean;
}

const MEDIA_PERMISSIONS = ["instagram_business_basic", "instagram_business_manage_insights"];
const MEDIA_INSIGHTS_ENDPOINT = "/{media-id}/insights";
const CONTENT_DISCOVERY_ENDPOINT = "/{ig-user-id}/media";
const ACCOUNT_INSIGHTS_ENDPOINT = "/{ig-user-id}/insights";

function media(entry: {
  contentType: ContentType;
  providerMetric: string;
  internalMetric: string;
  nativeUnit: string;
  normalizedUnit?: string;
  status: MetricRecordStatus;
  lastVerifiedDate: string;
  safeLimitation?: string;
  endpoint?: string;
  requiresIndependentRequest?: boolean;
}): MetricCapabilityEntry {
  return {
    platform: "instagram",
    scope: "media",
    accountType: "any",
    contentType: entry.contentType,
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: entry.endpoint ?? MEDIA_INSIGHTS_ENDPOINT,
    requiredPermissions: MEDIA_PERMISSIONS,
    nativeUnit: entry.nativeUnit,
    normalizedUnit: entry.normalizedUnit,
    status: entry.status,
    apiVersion: API_VERSION_REFERENCE,
    lastVerifiedDate: entry.lastVerifiedDate,
    safeLimitation: entry.safeLimitation,
    requiresIndependentRequest: entry.requiresIndependentRequest,
  };
}

function account(entry: {
  providerMetric: string;
  internalMetric: string;
  nativeUnit: string;
  status: MetricRecordStatus;
  lastVerifiedDate: string;
  period?: string;
  breakdown?: string;
  timeframe?: string;
  safeLimitation?: string;
}): MetricCapabilityEntry {
  return {
    platform: "instagram",
    scope: "account",
    accountType: "any",
    contentType: "account",
    providerMetric: entry.providerMetric,
    internalMetric: entry.internalMetric,
    endpoint: ACCOUNT_INSIGHTS_ENDPOINT,
    requiredPermissions: MEDIA_PERMISSIONS,
    period: entry.period,
    breakdown: entry.breakdown,
    timeframe: entry.timeframe,
    nativeUnit: entry.nativeUnit,
    status: entry.status,
    apiVersion: API_VERSION_REFERENCE,
    lastVerifiedDate: entry.lastVerifiedDate,
    safeLimitation: entry.safeLimitation,
  };
}

const LIVE_2026_08_01 = "2026-08-01";
// Re-diagnosed live against 4 real Reels (both the Instagram API with
// Instagram Login path used in production, and — to rule out the
// Facebook/Meta path — the connected Facebook Page's own token against
// the same media IDs). See scripts/diagnose-instagram-metrics.ts for
// the exact commands; raw evidence is quoted in each entry below.
const LIVE_2026_08_02 = "2026-08-02";

export const INSTAGRAM_METRIC_CAPABILITY_REGISTRY: MetricCapabilityEntry[] = [
  // ---------------------------------------------------------------
  // A. Reel — live-proven this session (production import + prior
  // per-metric isolation diagnostic against real reel content).
  // ---------------------------------------------------------------
  media({ contentType: "reel", providerMetric: "like_count", internalMetric: "likes", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "comments_count", internalMetric: "comments", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "views", internalMetric: "views", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "reach", internalMetric: "reach", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "saved", internalMetric: "saves", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "shares", internalMetric: "shares", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "reel", providerMetric: "total_interactions", internalMetric: "engagements", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({
    contentType: "reel",
    providerMetric: "ig_reels_avg_watch_time",
    internalMetric: "averageWatchTimeMs",
    nativeUnit: "milliseconds",
    status: "supported",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Meta returns this already in milliseconds — do not multiply by 1000 (corrected 2026-08-01 after live data showed a 1000x inflation).",
  }),
  media({
    contentType: "reel",
    providerMetric: "ig_reels_video_view_total_time",
    internalMetric: "totalWatchTimeMs",
    nativeUnit: "milliseconds",
    status: "supported",
    lastVerifiedDate: LIVE_2026_08_01,
  }),
  media({
    contentType: "reel",
    providerMetric: "impressions",
    internalMetric: "impressions",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Rejected IGApiException code=100 for real reel content; Meta docs also mark this metric deprecated for media created after 2024-07-02.",
  }),
  // Re-diagnosed live on 4 real Reels (2026-08-02, see
  // scripts/diagnose-instagram-metrics.ts): Meta's own IGApiException
  // code=100 response enumerates every valid metric name for this
  // media, and "plays" is not among them — "views" is. "views" was
  // requested on the same 4 Reels in the same diagnostic and returned
  // real, distinct values (609/1788/675/295), confirming it is the
  // current replacement, not a coincidental separate rejection. Not a
  // permission or content-type-eligibility issue — the metric name
  // itself no longer exists for Reels in this API version, so it is
  // classified "deprecated" (matching this file's convention for other
  // proven-superseded metric names) rather than "unsupported".
  media({
    contentType: "reel",
    providerMetric: "plays",
    internalMetric: "plays",
    nativeUnit: "count",
    status: "deprecated",
    lastVerifiedDate: LIVE_2026_08_02,
    safeLimitation: "Not available through current API",
  }),
  media({
    contentType: "reel",
    providerMetric: "follows",
    internalMetric: "follows",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Rejected for real reel content while the identical request succeeded for carousel content in the same diagnostic.",
  }),
  media({
    contentType: "reel",
    providerMetric: "profile_activity",
    internalMetric: "profileActivity",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Rejected for real reel content while the identical request succeeded for carousel content in the same diagnostic.",
  }),
  media({
    contentType: "reel",
    providerMetric: "profile_visits",
    internalMetric: "profileVisits",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: rejected for real reel content (IGApiException code=100), while confirmed supported for imagePost/carousel content on the same account.",
  }),
  media({
    contentType: "reel",
    providerMetric: "clips_replays_count",
    internalMetric: "replaysCount",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: rejected for real reel content (IGApiException code=100). Not found in current Meta documentation (v25.0) either — likely an older/renamed metric name.",
  }),
  media({
    contentType: "reel",
    providerMetric: "ig_reels_aggregated_all_plays_count",
    internalMetric: "aggregatedPlaysCount",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: rejected for real reel content (IGApiException code=100), consistent with being superseded by ig_reels_video_view_total_time.",
  }),
  media({
    contentType: "reel",
    providerMetric: "reels_skip_rate",
    internalMetric: "skipRate",
    nativeUnit: "percentage",
    status: "supported",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Meta documents this as an estimated, in-development metric — real production values observed (e.g. 61.7, 37.2) are plausible percentages, but Meta's own 'estimated' label means precision is not guaranteed.",
  }),
  // Re-diagnosed live on 4 real Reels (2026-08-02, see
  // scripts/diagnose-instagram-metrics.ts): every request for
  // facebook_views/crossposted_views returned OAuthException code=-1
  // subcode=2207086 — Meta's own documented explanation for this exact
  // subcode is that these metrics only return a value for a Reel
  // actually distributed to multiple places on Facebook. Independently
  // confirmed (not merely assumed from "a Facebook account is linked"):
  // GET /{page-id}?fields=instagram_business_account,connected_instagram_account
  // on the connected Facebook Page's own token returned neither field
  // at all — the Page is not linked to this (or any) Instagram
  // account, so Facebook-side distribution/crossposting is structurally
  // impossible right now. Also tried the alternate Facebook/Meta access
  // path directly: the Page's own token requesting these exact
  // Instagram media IDs from graph.facebook.com/v19.0 was rejected with
  // GraphMethodException code=100 subcode=33 ("object does not exist or
  // missing permissions"), consistent with — not contradicted by — the
  // missing link. This is a per-account, per-content-type finding, not
  // a permanent global judgment: if this Page/account ever links and a
  // Reel is genuinely distributed to/crossposted on Facebook, it must
  // be re-tested rather than left at this status (see
  // InstagramConnector's refineReelMetricStatus, which re-checks the
  // live error signature on every import rather than hardcoding this).
  media({
    contentType: "reel",
    providerMetric: "facebook_views",
    internalMetric: "facebookViews",
    nativeUnit: "count",
    status: "noFacebookDistribution",
    lastVerifiedDate: LIVE_2026_08_02,
    safeLimitation: "Not available through current API",
  }),
  media({
    contentType: "reel",
    providerMetric: "crossposted_views",
    internalMetric: "crosspostedViews",
    nativeUnit: "count",
    status: "notCrossposted",
    lastVerifiedDate: LIVE_2026_08_02,
    safeLimitation: "Not available through current API",
  }),

  // ---------------------------------------------------------------
  // B. Image post — live-proven for the metrics the old shared
  // request already exercised; account-activity metrics kept
  // separate pending an independent imagePost-specific live test
  // (they were only confirmed for carousel content, not imagePost).
  // ---------------------------------------------------------------
  media({ contentType: "imagePost", providerMetric: "like_count", internalMetric: "likes", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "comments_count", internalMetric: "comments", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "views", internalMetric: "views", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "reach", internalMetric: "reach", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "saved", internalMetric: "saves", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "shares", internalMetric: "shares", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "total_interactions", internalMetric: "engagements", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "follows", internalMetric: "follows", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "profile_activity", internalMetric: "profileActivity", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "imagePost", providerMetric: "profile_visits", internalMetric: "profileVisits", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({
    contentType: "imagePost",
    providerMetric: "impressions",
    internalMetric: "impressions",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Rejected IGApiException code=100 for real feed content; Meta docs mark this deprecated for media created after 2024-07-02.",
  }),

  // ---------------------------------------------------------------
  // C. Carousel — live-proven independently from image posts
  // (original per-field isolation diagnostic used a real carousel).
  // ---------------------------------------------------------------
  media({ contentType: "carousel", providerMetric: "like_count", internalMetric: "likes", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "comments_count", internalMetric: "comments", nativeUnit: "count", status: "supported", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "views", internalMetric: "views", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "reach", internalMetric: "reach", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "saved", internalMetric: "saves", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "shares", internalMetric: "shares", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "total_interactions", internalMetric: "engagements", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "follows", internalMetric: "follows", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "profile_activity", internalMetric: "profileActivity", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({ contentType: "carousel", providerMetric: "profile_visits", internalMetric: "profileVisits", nativeUnit: "count", status: "supported", lastVerifiedDate: LIVE_2026_08_01 }),
  media({
    contentType: "carousel",
    providerMetric: "impressions",
    internalMetric: "impressions",
    nativeUnit: "count",
    status: "invalidForContentType",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Rejected IGApiException code=100 for real carousel content; Meta docs mark this deprecated for media created after 2024-07-02.",
  }),

  // ---------------------------------------------------------------
  // D. Feed video — never live-tested: no real Instagram feed VIDEO
  // (non-Reel, non-Story) has appeared in this account's content yet.
  // Every candidate stays "untested" until one does.
  // ---------------------------------------------------------------
  ...(
    [
      ["views", "views", "count"],
      ["reach", "reach", "count"],
      ["saved", "saves", "count"],
      ["shares", "shares", "count"],
      ["total_interactions", "engagements", "count"],
      ["follows", "follows", "count"],
      ["profile_activity", "profileActivity", "count"],
      ["profile_visits", "profileVisits", "count"],
    ] as const
  ).map(([providerMetric, internalMetric, nativeUnit]) =>
    media({
      contentType: "feedVideo",
      providerMetric,
      internalMetric,
      nativeUnit,
      status: "untested",
      lastVerifiedDate: LIVE_2026_08_01,
      safeLimitation: "No real Instagram feed video (non-Reel, non-Story) has been available to test against yet.",
    }),
  ),
  media({ contentType: "feedVideo", providerMetric: "like_count", internalMetric: "likes", nativeUnit: "count", status: "untested", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01, safeLimitation: "No real Instagram feed video has been available to test against yet." }),
  media({ contentType: "feedVideo", providerMetric: "comments_count", internalMetric: "comments", nativeUnit: "count", status: "untested", endpoint: CONTENT_DISCOVERY_ENDPOINT, lastVerifiedDate: LIVE_2026_08_01, safeLimitation: "No real Instagram feed video has been available to test against yet." }),

  // ---------------------------------------------------------------
  // E. Story — capability map and schema only, per this task's
  // explicit instruction not to claim live support without a real
  // Story object. Every candidate is "untested", never "unsupported".
  // ---------------------------------------------------------------
  ...(
    [
      ["views", "views", "count"],
      ["reach", "reach", "count"],
      ["replies", "replies", "count"],
      ["shares", "shares", "count"],
      ["navigation", "navigation", "count"],
    ] as const
  ).map(([providerMetric, internalMetric, nativeUnit]) =>
    media({
      contentType: "story",
      providerMetric,
      internalMetric,
      nativeUnit,
      status: "untested",
      lastVerifiedDate: LIVE_2026_08_01,
      safeLimitation: "No real Story object has been available to test against yet — this is a documented candidate only.",
    }),
  ),
  media({
    contentType: "story",
    providerMetric: "exits",
    internalMetric: "exits",
    nativeUnit: "count",
    status: "deprecated",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Not present in current Meta Instagram media-insights documentation (v25.0); the documented 'navigation' metric with a story_navigation_action_type breakdown appears to supersede it. Still untested live — no real Story exists yet.",
  }),
  media({
    contentType: "story",
    providerMetric: "taps_forward",
    internalMetric: "tapsForward",
    nativeUnit: "count",
    status: "deprecated",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Not present in current Meta documentation (v25.0); likely superseded by 'navigation' breakdown values. Still untested live.",
  }),
  media({
    contentType: "story",
    providerMetric: "taps_back",
    internalMetric: "tapsBack",
    nativeUnit: "count",
    status: "deprecated",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Not present in current Meta documentation (v25.0); likely superseded by 'navigation' breakdown values. Still untested live.",
  }),

  // ---------------------------------------------------------------
  // Account-level — implemented and live-tested for the first time in
  // this task's own production verification run (2026-08-01).
  // ---------------------------------------------------------------
  account({ providerMetric: "reach", internalMetric: "reach", nativeUnit: "count", status: "supported", period: "day", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "views", internalMetric: "views", nativeUnit: "count", status: "supported", period: "day", lastVerifiedDate: LIVE_2026_08_01 }),
  account({
    providerMetric: "profile_views",
    internalMetric: "profileViews",
    nativeUnit: "count",
    status: "deprecated",
    period: "day",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Deprecated in Graph API v22.0; replaced by 'views'.",
  }),
  account({
    providerMetric: "website_clicks",
    internalMetric: "websiteClicks",
    nativeUnit: "count",
    status: "deprecated",
    period: "day",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Deprecated in Graph API v22.0; profile_links_taps (contact_button_type breakdown) is the current equivalent.",
  }),
  account({ providerMetric: "profile_links_taps", internalMetric: "profileLinksTaps", nativeUnit: "count", status: "untested", period: "day", breakdown: "contact_button_type", lastVerifiedDate: LIVE_2026_08_01, safeLimitation: "Requested live as its own request-parameter group; not yet observed with a real non-empty result." }),
  account({
    providerMetric: "follower_count",
    internalMetric: "followerCount",
    nativeUnit: "count",
    status: "empty",
    period: "day",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: metric accepted (no error) but returned empty for this account, despite Meta's documented ≥100-follower threshold appearing to be met (follower_demographics returned real non-empty data in the same run). Not flagged unavailableDueToAccountSize since that specific explanation is not confirmed — cause not yet understood.",
  }),
  account({
    providerMetric: "follows_and_unfollows",
    internalMetric: "followsAndUnfollows",
    nativeUnit: "count",
    status: "untested",
    period: "day",
    breakdown: "follow_type",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Requested live as its own request-parameter group; not yet observed with a real non-empty result. Meta documents this as requiring 100+ followers.",
  }),
  account({ providerMetric: "accounts_engaged", internalMetric: "accountsEngaged", nativeUnit: "count", status: "supported", period: "day", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "total_interactions", internalMetric: "engagements", nativeUnit: "count", status: "supported", period: "day", breakdown: "media_product_type", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "likes", internalMetric: "likes", nativeUnit: "count", status: "supported", period: "day", breakdown: "media_product_type", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "comments", internalMetric: "comments", nativeUnit: "count", status: "supported", period: "day", breakdown: "media_product_type", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "shares", internalMetric: "shares", nativeUnit: "count", status: "supported", period: "day", breakdown: "media_product_type", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "saves", internalMetric: "saves", nativeUnit: "count", status: "supported", period: "day", breakdown: "media_product_type", lastVerifiedDate: LIVE_2026_08_01 }),
  account({ providerMetric: "replies", internalMetric: "replies", nativeUnit: "count", status: "supported", period: "day", lastVerifiedDate: LIVE_2026_08_01 }),
  account({
    providerMetric: "content_views",
    internalMetric: "contentViews",
    nativeUnit: "count",
    status: "empty",
    period: "day",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: metric accepted (no error) but returned empty for this account. Not found in current Meta account-insights documentation (v25.0) either — may be deprecated or renamed.",
  }),
  account({
    providerMetric: "online_followers",
    internalMetric: "onlineFollowers",
    nativeUnit: "count",
    status: "empty",
    period: "lifetime",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: metric accepted (no error) but returned empty for this account. Meta documents this as only reflecting the last 30 days of online activity, regardless of requested range.",
  }),
  account({
    providerMetric: "follower_demographics",
    internalMetric: "followerDemographics",
    nativeUnit: "count",
    status: "supported",
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response returned six real per-age-bucket values summing to well over 100 — these are raw follower counts, not percentages (corrected from an earlier, untested assumption of nativeUnit 'percentage'). Meta documents this as unavailable below 100 followers, returning an empty (not error) result in that case.",
  }),
  account({
    providerMetric: "engaged_audience_demographics",
    internalMetric: "engagedAudienceDemographics",
    nativeUnit: "count",
    status: "unsupported",
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: rejected (requestRejected) for this account/timeframe/breakdown combination — a genuine request rejection, not the documented empty-below-100-engagements case.",
  }),
  account({
    providerMetric: "reached_audience_demographics",
    internalMetric: "reachedAudienceDemographics",
    nativeUnit: "count",
    status: "unsupported",
    period: "lifetime",
    breakdown: "age",
    timeframe: "this_month",
    lastVerifiedDate: LIVE_2026_08_01,
    safeLimitation: "Live production response: rejected (requestRejected). Not found in current Meta account-insights documentation (v25.0) either — likely deprecated or merged into follower/engaged demographics.",
  }),
];
