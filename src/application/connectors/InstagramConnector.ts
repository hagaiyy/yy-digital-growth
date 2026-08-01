import type {
  MetaSafeError,
  MetricFailureReason,
  MetricsFetchOutcome,
  PlatformConnector,
  RecentContentItem,
  VerifiedIdentity,
} from "./types";
import { ConnectorError, extractMetaSafeError } from "./types";
import { mapInstagramContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";
import type { ContentType } from "@/domain/models/ImportedContent";

// Instagram API with Instagram Login: the Instagram professional account
// authorizes directly against Instagram's own OAuth endpoints using the
// app's Instagram App ID/Secret (INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET —
// never META_APP_ID/META_APP_SECRET, and never a Facebook Page). There is
// no Facebook Login for Business indirection here and no environment-
// supplied access token — "Connect" starts a real browser authorization
// redirect, exactly like the Facebook Account and Pinterest connections.
const AUTHORIZATION_BASE = "https://www.instagram.com/oauth/authorize";
const SHORT_LIVED_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_API_BASE = "https://graph.instagram.com";
const LONG_LIVED_TOKEN_URL = `${GRAPH_API_BASE}/access_token`;

// Exactly the two scopes this connection needs — never the older
// Facebook-Login-for-Business scopes (instagram_basic,
// instagram_manage_insights, pages_show_list, pages_read_engagement),
// which this app's Instagram App ID/Secret pairing does not support and
// which Meta rejects with "Invalid Scopes".
const OAUTH_SCOPE = "instagram_business_basic,instagram_business_manage_insights";

interface InstagramMediaNode {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramTokenSet {
  accessToken: string;
  expiresAt?: string;
}

// Built from a live production diagnostic against real content of each
// type, not from documentation alone. `impressions` and `plays` were
// confirmed rejected (IGApiException code=100, "invalid for this
// content's type") for every real reel and feed item tested, and are
// deliberately excluded rather than requested and discarded on every
// import. `views` is the metric Meta's newer API versions use in their
// place; requested speculatively since it degrades safely if wrong
// (fetchContentMetrics tries the whole list together first, and only
// bisects metric-by-metric if something in it is rejected — one bad
// metric name can never erase the others). `likes`/`comments` are
// deliberately not requested here — they are already available for free
// from content discovery's like_count/comments_count fields.
function metricCandidatesFor(contentType: ContentType): string[] {
  switch (contentType) {
    case "reel":
      return [
        "views",
        "reach",
        "saved",
        "shares",
        "total_interactions",
        "ig_reels_avg_watch_time",
        "ig_reels_video_view_total_time",
      ];
    case "video":
    case "imagePost":
    case "carousel":
      return ["views", "reach", "saved", "shares", "total_interactions", "follows", "profile_activity"];
    case "story":
      // No live story was available to test against at the time this
      // was written — these are Meta's documented story-insight metric
      // names, and fetchContentMetrics verifies each one live rather
      // than assuming support.
      return ["reach", "exits", "replies", "taps_forward", "taps_back", "navigation"];
    default:
      return ["reach", "saved", "shares", "total_interactions"];
  }
}

const METRIC_OUTPUT_NAMES: Record<string, string> = {
  views: "views",
  reach: "reach",
  saved: "saves",
  shares: "shares",
  total_interactions: "engagements",
  ig_reels_avg_watch_time: "averageWatchTimeMs",
  ig_reels_video_view_total_time: "totalWatchTimeMs",
  follows: "follows",
  profile_activity: "profileActivity",
  exits: "exits",
  replies: "replies",
  taps_forward: "tapsForward",
  taps_back: "tapsBack",
  navigation: "navigation",
};

function outputNameFor(metric: string): string {
  return METRIC_OUTPUT_NAMES[metric] ?? metric;
}

// Live production data disproved the original assumption here: a reel
// with 609 real views returning a raw ig_reels_avg_watch_time of 10465
// would be ~174 minutes of average watch time if treated as seconds —
// impossible for a short-form Reel. Meta already returns these two
// watch-time metrics in milliseconds; the value is stored as-is, with no
// unit conversion, and the ~9-10s figures that result are consistent
// with real Reel-length viewing behavior.
function normalizeMetricValue(_metric: string, value: number): number {
  return value;
}

// Classification is based on what was actually observed live: every
// rejection Instagram returned for these candidate metrics was
// IGApiException code=100, and in every case the cause was confirmed to
// be that the metric does not apply to that specific content's type
// (e.g. "views" on very old media, reel-only metrics on a feed post) —
// never a missing permission. code=10 / 190 are kept distinct in case
// account or token state changes in the future.
function classifyInstagramMetricFailure(error: MetaSafeError | null): MetricFailureReason {
  if (!error) return "providerError";
  if (error.code === 190) return "tokenInvalid";
  if (error.code === 10) return "permissionMissing";
  if (error.code === 100) return "invalidMetricForContentType";
  return "requestRejected";
}

function getConfig() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) return null;
  // A placeholder/test value must never be treated as real
  // configuration — that would send the user into a live OAuth redirect
  // that is guaranteed to fail.
  if (isPlaceholderValue(appId) || isPlaceholderValue(appSecret)) return null;
  return { appId, appSecret, redirectUri };
}

// Names only — never a value.
function missingInstagramConfigVars(): string[] {
  const missing: string[] = [];
  if (!process.env.INSTAGRAM_APP_ID || isPlaceholderValue(process.env.INSTAGRAM_APP_ID)) {
    missing.push("INSTAGRAM_APP_ID");
  }
  if (!process.env.INSTAGRAM_APP_SECRET || isPlaceholderValue(process.env.INSTAGRAM_APP_SECRET)) {
    missing.push("INSTAGRAM_APP_SECRET");
  }
  if (!process.env.INSTAGRAM_REDIRECT_URI) missing.push("INSTAGRAM_REDIRECT_URI");
  return missing;
}

async function parseJsonOrThrow<T>(response: Response, safeMessage: string): Promise<T> {
  if (!response.ok) {
    throw new ConnectorError("failed", safeMessage);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ConnectorError("failed", "Instagram returned an unexpected response.");
  }
}

// One request for a set of metric names against a single media node's
// /insights edge — returns either the raw name->value map Meta
// returned, or (for a non-ok response) its safe error fields. Module-
// scoped rather than a private class method: a `private` method would
// make InstagramConnector nominally typed, which breaks structural
// compatibility with the fake connector used in tests (the same reason
// PinterestConnector's requestToken helper is module-scoped).
async function requestInsights(
  externalContentId: string,
  accessToken: string,
  metricNames: string[],
): Promise<{ ok: true; values: Map<string, number> } | { ok: false; error: MetaSafeError | null }> {
  const url = new URL(`${GRAPH_API_BASE}/${externalContentId}/insights`);
  url.searchParams.set("metric", metricNames.join(","));
  url.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    return { ok: false, error: null };
  }
  if (!response.ok) {
    return { ok: false, error: await extractMetaSafeError(response) };
  }
  let body: { data?: Array<{ name: string; values?: Array<{ value?: number }> }> };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, error: null };
  }
  const values = new Map<string, number>();
  for (const entry of body.data ?? []) {
    const value = entry.values?.[0]?.value;
    if (typeof value === "number") values.set(entry.name, value);
  }
  return { ok: true, values };
}

export class InstagramConnector implements PlatformConnector {
  readonly platform = "instagram" as const;

  isConfigured(): boolean {
    return getConfig() !== null;
  }

  // Names only — never a value — so the UI can tell the user exactly
  // which application environment variable(s) to set without exposing
  // anything. These are Instagram app credentials, never a user access
  // token.
  getMissingConfigVars(): string[] {
    return missingInstagramConfigVars();
  }

  buildAuthorizationUrl(state: string): string {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Instagram is not configured. Missing environment variable(s): ${missingInstagramConfigVars().join(", ")}.`,
      );
    }
    const url = new URL(AUTHORIZATION_BASE);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  // Two-step exchange, exactly as Instagram API with Instagram Login
  // requires: a short-lived token (~1 hour) from the authorization code,
  // immediately exchanged for a long-lived token (~60 days) so the
  // connection does not need re-authorization every hour.
  async exchangeCodeForToken(code: string): Promise<InstagramTokenSet> {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Instagram is not configured. Missing environment variable(s): ${missingInstagramConfigVars().join(", ")}.`,
      );
    }

    let shortLivedResponse: Response;
    try {
      shortLivedResponse = await fetch(SHORT_LIVED_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.appId,
          client_secret: config.appSecret,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
          code,
        }).toString(),
      });
    } catch {
      throw new ConnectorError("failed", "Instagram could not be reached to complete authorization.");
    }
    const shortLivedBody = await parseJsonOrThrow<{ access_token?: string }>(
      shortLivedResponse,
      "Instagram rejected the authorization request.",
    );
    if (!shortLivedBody.access_token) {
      throw new ConnectorError("failed", "Instagram did not return an access token.");
    }

    const longLivedUrl = new URL(LONG_LIVED_TOKEN_URL);
    longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
    longLivedUrl.searchParams.set("client_secret", config.appSecret);
    longLivedUrl.searchParams.set("access_token", shortLivedBody.access_token);

    let longLivedResponse: Response;
    try {
      longLivedResponse = await fetch(longLivedUrl, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Instagram could not be reached to complete authorization.");
    }
    const longLivedBody = await parseJsonOrThrow<{ access_token?: string; expires_in?: number }>(
      longLivedResponse,
      "Instagram rejected the long-lived token exchange.",
    );
    if (!longLivedBody.access_token) {
      throw new ConnectorError("failed", "Instagram did not return a long-lived access token.");
    }

    return {
      accessToken: longLivedBody.access_token,
      expiresAt:
        typeof longLivedBody.expires_in === "number"
          ? new Date(Date.now() + longLivedBody.expires_in * 1000).toISOString()
          : undefined,
    };
  }

  // Used both right after exchangeCodeForToken() and later by the
  // "Verify" action on an already-connected card, using the stored,
  // decrypted Instagram access token — never an env-supplied token. The
  // access token is scoped to exactly one Instagram professional
  // account, so no separate account id is needed to look it up.
  async fetchConnectedInstagramAccount(accessToken: string): Promise<VerifiedIdentity> {
    return this.verifyAccountStillValid(accessToken);
  }

  async verifyAccountStillValid(accessToken: string): Promise<VerifiedIdentity> {
    const url = new URL(`${GRAPH_API_BASE}/me`);
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError(
        "failed",
        "Instagram could not be reached to verify the connection. Please try again later.",
      );
    }

    if (!response.ok) {
      throw new ConnectorError(
        "failed",
        "Instagram rejected the stored credential. The connection may need to be reconnected.",
      );
    }

    let body: { user_id?: string; username?: string; account_type?: string };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ConnectorError("failed", "Instagram returned an unexpected response.");
    }

    if (!body.user_id) {
      throw new ConnectorError("failed", "Instagram did not return an account identity.");
    }

    return {
      externalAccountId: body.user_id,
      displayName: body.username,
      accountType: body.account_type,
      grantedScopes: OAUTH_SCOPE.split(","),
    };
  }

  async fetchRecentContent(
    accessToken: string,
    accountId: string,
    limit: number,
  ): Promise<RecentContentItem[]> {
    const url = new URL(`${GRAPH_API_BASE}/${accountId}/media`);
    url.searchParams.set(
      "fields",
      "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Instagram could not be reached to retrieve recent content.");
    }
    if (!response.ok) {
      throw new ConnectorError("failed", "Instagram rejected the recent-content request.");
    }

    let body: { data?: InstagramMediaNode[] };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ConnectorError("failed", "Instagram returned an unexpected response.");
    }

    return (body.data ?? []).map((node) => ({
      externalContentId: node.id,
      contentType: mapInstagramContentType(node.media_type, node.media_product_type),
      caption: node.caption ?? null,
      permalink: node.permalink ?? null,
      thumbnailUrl: node.thumbnail_url ?? node.media_url ?? null,
      publishedAt: node.timestamp ?? null,
      platformData: {
        media_type: node.media_type,
        media_product_type: node.media_product_type,
        like_count: node.like_count,
        comments_count: node.comments_count,
      },
    }));
  }

  // Per-metric outcomes, never all-or-nothing: the full candidate list
  // for this content type is requested together first (one request, the
  // common case whenever every candidate genuinely applies); only if
  // that combined request is rejected does this fall back to requesting
  // each metric individually, so a single invalid-for-this-type or
  // otherwise rejected metric can never erase the others.
  async fetchContentMetrics(
    accessToken: string,
    externalContentId: string,
    contentType: ContentType,
    knownEngagement: { likeCount?: number; commentsCount?: number },
  ): Promise<MetricsFetchOutcome> {
    const metrics: Record<string, number | string | null> = {};
    const successfulMetrics: string[] = [];
    const failedMetrics: { metric: string; reason: MetricFailureReason }[] = [];

    // Already known for free from content discovery — never re-requested.
    if (typeof knownEngagement.likeCount === "number") {
      metrics.likes = knownEngagement.likeCount;
      successfulMetrics.push("likes");
    }
    if (typeof knownEngagement.commentsCount === "number") {
      metrics.comments = knownEngagement.commentsCount;
      successfulMetrics.push("comments");
    }

    const candidates = metricCandidatesFor(contentType);
    const combined = await requestInsights(externalContentId, accessToken, candidates);

    if (combined.ok) {
      for (const metric of candidates) {
        const value = combined.values.get(metric);
        if (typeof value === "number") {
          successfulMetrics.push(metric);
          metrics[outputNameFor(metric)] = normalizeMetricValue(metric, value);
        } else {
          failedMetrics.push({ metric, reason: "metricUnsupported" });
        }
      }
    } else {
      for (const metric of candidates) {
        const single = await requestInsights(externalContentId, accessToken, [metric]);
        if (!single.ok) {
          failedMetrics.push({ metric, reason: classifyInstagramMetricFailure(single.error) });
          continue;
        }
        const value = single.values.get(metric);
        if (typeof value !== "number") {
          failedMetrics.push({ metric, reason: "metricUnsupported" });
          continue;
        }
        successfulMetrics.push(metric);
        metrics[outputNameFor(metric)] = normalizeMetricValue(metric, value);
      }
    }

    if (successfulMetrics.length === 0) {
      return {
        kind: "unsupported",
        failedMetrics,
        safeMessage: "Instagram does not provide performance metrics for this content.",
      };
    }

    return {
      kind: "success",
      metrics,
      successfulMetrics,
      failedMetrics,
      dataCompleteness: failedMetrics.length === 0 ? "complete" : "partial",
    };
  }
}
