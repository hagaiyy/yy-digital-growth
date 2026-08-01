import type { MetricsFetchOutcome, PlatformConnector, RecentContentItem, VerifiedIdentity } from "./types";
import { ConnectorError } from "./types";
import { mapInstagramContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";

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

function metricListFor(mediaProductType: string | undefined): string[] {
  const type = mediaProductType?.toUpperCase();
  if (type === "REELS") {
    return ["plays", "reach", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"];
  }
  if (type === "STORY") {
    return ["impressions", "reach", "exits", "replies", "taps_forward", "taps_back"];
  }
  // FEED (image/carousel) and anything else recognized as a still post.
  return ["impressions", "reach", "saved"];
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

  async fetchContentMetrics(
    accessToken: string,
    externalContentId: string,
    mediaProductType: string | undefined,
    knownEngagement: { likeCount?: number; commentsCount?: number },
  ): Promise<MetricsFetchOutcome> {
    const requestedMetrics = metricListFor(mediaProductType);
    const url = new URL(`${GRAPH_API_BASE}/${externalContentId}/insights`);
    url.searchParams.set("metric", requestedMetrics.join(","));
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      return { kind: "failed", safeMessage: "Instagram could not be reached to retrieve metrics." };
    }

    if (!response.ok) {
      // Instagram returns an error for media types/ages that do not
      // support insights (e.g. very old media) — treated as unsupported
      // rather than failed, since retrying will not help.
      return {
        kind: "unsupported",
        safeMessage: "Instagram does not provide performance metrics for this content.",
      };
    }

    let body: { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { kind: "failed", safeMessage: "Instagram returned an unexpected metrics response." };
    }

    const raw = new Map<string, number>();
    for (const entry of body.data ?? []) {
      const value = entry.values?.[0]?.value;
      if (typeof value === "number") raw.set(entry.name, value);
    }

    const metrics: Record<string, number | string | null> = {
      likes: knownEngagement.likeCount ?? null,
      comments: knownEngagement.commentsCount ?? null,
    };
    if (raw.has("plays")) metrics.views = raw.get("plays")!;
    if (raw.has("impressions")) metrics.impressions = raw.get("impressions")!;
    if (raw.has("reach")) metrics.reach = raw.get("reach")!;
    if (raw.has("saved")) metrics.saves = raw.get("saved")!;
    if (raw.has("shares")) metrics.shares = raw.get("shares")!;
    if (raw.has("total_interactions")) metrics.engagements = raw.get("total_interactions")!;
    if (raw.has("ig_reels_avg_watch_time")) {
      metrics.averageWatchTimeMs = Math.round(raw.get("ig_reels_avg_watch_time")! * 1000);
    }
    if (raw.has("exits")) metrics.exits = raw.get("exits")!;
    if (raw.has("replies")) metrics.replies = raw.get("replies")!;
    if (raw.has("taps_forward")) metrics.tapsForward = raw.get("taps_forward")!;
    if (raw.has("taps_back")) metrics.tapsBack = raw.get("taps_back")!;

    const dataCompleteness = raw.size >= requestedMetrics.length ? "complete" : "partial";
    return { kind: "success", metrics, dataCompleteness };
  }
}
