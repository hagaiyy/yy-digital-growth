import type {
  MetaSafeError,
  MetricFailure,
  MetricFailureReason,
  MetricsFetchOutcome,
  PlatformConnector,
  RecentContentItem,
  VerifiedIdentity,
} from "./types";
import { ConnectorError, extractMetaSafeError } from "./types";
import { mapFacebookContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";
import type { ContentType } from "@/domain/models/ImportedContent";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

// Read-only scope only: no publishing, advertising, moderation,
// messaging, ads, or webhook permission is requested. `read_insights`
// was added once the Meta Developer app marked it "Ready for testing" —
// previously Meta rejected it for this app with "Invalid Scopes", which
// is why Page-level and several post-level metrics degraded to
// "unsupported" (see fetchPagePostMetrics). `business_management` is
// deliberately not requested: fetchManagedPages only ever calls
// GET /me/accounts, which needs no Business Manager permission.
const OAUTH_SCOPE = "public_profile,pages_show_list,pages_read_engagement,read_insights";

// Stage A (content discovery) fields only — see fetchPageContent. Engagement
// fields (likes/comments summary, shares) are proven to require a
// permission this app's Page token does not have (live-tested: rejected
// everywhere with OAuthException code=10) and are fetched independently,
// per post, in fetchPagePostMetrics instead.
interface FacebookPostNode {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data?: Array<{ type?: string; media_type?: string }> };
}

export interface FacebookManagedPage {
  id: string;
  name: string;
  category?: string;
  accessToken: string;
}

function getConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) return null;
  // A placeholder/test value (e.g. left over from proving out the setup
  // flow) must never be treated as real configuration — that would send
  // the user into a live OAuth redirect that is guaranteed to fail.
  if (isPlaceholderValue(appId) || isPlaceholderValue(appSecret)) return null;
  return { appId, appSecret, redirectUri };
}

// Names only — never a value.
function missingFacebookConfigVars(): string[] {
  const missing: string[] = [];
  if (!process.env.META_APP_ID || isPlaceholderValue(process.env.META_APP_ID)) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET || isPlaceholderValue(process.env.META_APP_SECRET)) missing.push("META_APP_SECRET");
  if (!process.env.META_REDIRECT_URI) missing.push("META_REDIRECT_URI");
  return missing;
}

// Meta's own error responses are a structured `{ error: { type, code,
// error_subcode, fbtrace_id, message } }` shape. `type`/`code`/
// `error_subcode`/`fbtrace_id` are diagnostic codes Meta documents for
// developer support and never contain a token, secret, or request URL —
// safe to surface. The free-text `message` is deliberately excluded,
// consistent with never echoing platform response text back to the user.
async function safeMetaErrorSuffix(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      error?: { type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
    };
    const meta = body.error;
    if (!meta) return "";
    const parts = [
      meta.type ? `type=${meta.type}` : null,
      typeof meta.code === "number" ? `code=${meta.code}` : null,
      typeof meta.error_subcode === "number" ? `subcode=${meta.error_subcode}` : null,
      meta.fbtrace_id ? `fbtrace_id=${meta.fbtrace_id}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
  } catch {
    return "";
  }
}

async function parseJsonOrThrow<T>(response: Response, safeMessage: string): Promise<T> {
  if (!response.ok) {
    throw new ConnectorError("failed", `${safeMessage}${await safeMetaErrorSuffix(response)}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ConnectorError("failed", "Facebook returned an unexpected response.");
  }
}

// Maps Meta's safe, structured error fields to one of our closed set of
// per-metric failure reasons. code=190 is a well-known token/session
// error; code=10 is what live isolation testing proved is returned for
// permission-gated fields (likes.summary, comments.summary) on this
// app's Page token; code=100 is Meta's generic invalid-parameter/
// unsupported-for-object code. Anything else is reported as a plain
// rejection rather than guessed at.
function classifyFacebookMetricFailure(error: MetaSafeError | null): MetricFailureReason {
  if (!error) return "requestRejected";
  if (error.code === 190) return "tokenInvalid";
  if (error.code === 10) return "permissionMissing";
  if (error.code === 100) return "metricUnsupported";
  return "requestRejected";
}

// Module-scoped rather than private class methods: a `private` method
// makes FacebookConnector nominally typed, which breaks structural
// compatibility with the fake connector used in tests (see the same
// pattern documented in InstagramConnector.ts's requestInsights).
async function requestFacebookField(
  postId: string,
  pageAccessToken: string,
  fieldParam: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: MetaSafeError | null }> {
  const url = new URL(`${GRAPH_API_BASE}/${postId}`);
  url.searchParams.set("fields", fieldParam);
  url.searchParams.set("access_token", pageAccessToken);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    return { ok: false, error: null };
  }
  if (!response.ok) {
    return { ok: false, error: await extractMetaSafeError(response) };
  }
  try {
    return { ok: true, body: (await response.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, error: null };
  }
}

async function requestFacebookInsights(
  postId: string,
  pageAccessToken: string,
  metricNames: string[],
): Promise<{ ok: true; values: Map<string, number> } | { ok: false; error: MetaSafeError | null }> {
  const url = new URL(`${GRAPH_API_BASE}/${postId}/insights`);
  url.searchParams.set("metric", metricNames.join(","));
  url.searchParams.set("access_token", pageAccessToken);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    return { ok: false, error: null };
  }
  if (!response.ok) {
    return { ok: false, error: await extractMetaSafeError(response) };
  }
  try {
    const body = (await response.json()) as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
    const values = new Map<string, number>();
    for (const entry of body.data ?? []) {
      const value = entry.values?.[0]?.value;
      if (typeof value === "number") values.set(entry.name, value);
    }
    return { ok: true, values };
  } catch {
    return { ok: false, error: null };
  }
}

// Base metrics are attempted for every Page post; video-specific metrics
// are only attempted for content our own mapper classified as video —
// never sent to image/unknown posts, per the "explicit metric map by
// content type" requirement.
const BASE_INSIGHTS_METRICS = ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_clicks"];
const VIDEO_INSIGHTS_METRICS = ["post_video_views", "post_video_views_unique", "post_video_avg_time_watched"];

const INSIGHTS_METRIC_OUTPUT_NAMES: Record<string, string> = {
  post_impressions: "impressions",
  post_impressions_unique: "reach",
  post_engaged_users: "engagedUsers",
  post_clicks: "clicks",
  post_video_views: "videoViews",
  post_video_views_unique: "videoViewsUnique",
  post_video_avg_time_watched: "averageWatchTimeMs",
};

function insightsMetricCandidatesFor(contentType: ContentType): string[] {
  if (contentType === "video" || contentType === "reel") {
    return [...BASE_INSIGHTS_METRICS, ...VIDEO_INSIGHTS_METRICS];
  }
  return BASE_INSIGHTS_METRICS;
}

export class FacebookConnector implements PlatformConnector {
  readonly platform = "facebook" as const;

  isConfigured(): boolean {
    return getConfig() !== null;
  }

  getMissingConfigVars(): string[] {
    return missingFacebookConfigVars();
  }

  buildAuthorizationUrl(state: string): string {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Facebook is not configured. Missing environment variable(s): ${missingFacebookConfigVars().join(", ")}.`,
      );
    }
    const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Facebook is not configured. Missing environment variable(s): ${missingFacebookConfigVars().join(", ")}.`,
      );
    }
    const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("client_secret", config.appSecret);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("code", code);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Facebook could not be reached to complete authorization.");
    }
    const body = await parseJsonOrThrow<{ access_token?: string }>(
      response,
      "Facebook rejected the authorization request.",
    );
    if (!body.access_token) {
      throw new ConnectorError("failed", "Facebook did not return an access token.");
    }
    return body.access_token;
  }

  async fetchIdentity(accessToken: string): Promise<VerifiedIdentity> {
    const url = new URL(`${GRAPH_API_BASE}/me`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Facebook could not be reached to verify identity.");
    }
    const body = await parseJsonOrThrow<{ id?: string; name?: string }>(
      response,
      "Facebook rejected the account verification request.",
    );
    if (!body.id) {
      throw new ConnectorError("failed", "Facebook did not return an account identity.");
    }
    return {
      externalAccountId: body.id,
      displayName: body.name,
      accountType: "personal",
      grantedScopes: [],
    };
  }

  async fetchManagedPages(accountAccessToken: string): Promise<FacebookManagedPage[]> {
    const url = new URL(`${GRAPH_API_BASE}/me/accounts`);
    url.searchParams.set("fields", "id,name,category,access_token");
    url.searchParams.set("access_token", accountAccessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Facebook could not be reached to retrieve managed Pages.");
    }
    const body = await parseJsonOrThrow<{
      data?: Array<{ id: string; name: string; category?: string; access_token: string }>;
    }>(response, "Facebook rejected the managed-Pages request.");

    return (body.data ?? []).map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category,
      accessToken: page.access_token,
    }));
  }

  async verifyPageStillManaged(pageId: string, pageAccessToken: string): Promise<VerifiedIdentity> {
    const url = new URL(`${GRAPH_API_BASE}/${pageId}`);
    url.searchParams.set("fields", "id,name,category");
    url.searchParams.set("access_token", pageAccessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Facebook could not be reached to verify the Page.");
    }
    const body = await parseJsonOrThrow<{ id?: string; name?: string; category?: string }>(
      response,
      "Facebook rejected the Page verification request.",
    );
    if (!body.id) {
      throw new ConnectorError("failed", "Facebook did not return a Page identity.");
    }
    return {
      externalAccountId: body.id,
      displayName: body.name,
      accountType: body.category,
      grantedScopes: [],
    };
  }

  async fetchPageContent(
    pageAccessToken: string,
    pageId: string,
    limit: number,
  ): Promise<RecentContentItem[]> {
    const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
    // Stage A — content discovery only. Fields proven safe by live
    // isolation testing (facebookPageFields diagnostic): id, created_time,
    // message, permalink_url, attachments{type,media_type}, full_picture
    // are all either supported or merely empty, never rejected. Engagement
    // summary fields (likes/comments) are proven to be rejected with
    // OAuthException code=10 for this app's Page token and are
    // deliberately excluded here so they can never block post identity
    // import — they are fetched independently in fetchPagePostMetrics.
    url.searchParams.set(
      "fields",
      "id,created_time,message,permalink_url,attachments{type,media_type},full_picture",
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("access_token", pageAccessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new ConnectorError("failed", "Facebook could not be reached to retrieve Page posts.");
    }
    const body = await parseJsonOrThrow<{ data?: FacebookPostNode[] }>(
      response,
      "Facebook rejected the Page posts request.",
    );

    return (body.data ?? []).map((node) => {
      const attachment = node.attachments?.data?.[0];
      return {
        externalContentId: node.id,
        contentType: mapFacebookContentType(false, attachment?.media_type ?? attachment?.type),
        caption: node.message ?? null,
        permalink: node.permalink_url ?? null,
        thumbnailUrl: node.full_picture ?? null,
        publishedAt: node.created_time ?? null,
        platformData: {
          attachment_type: attachment?.type,
          attachment_media_type: attachment?.media_type,
        },
      };
    });
  }

  // Stage B — per-post metrics, fetched independently of Stage A so one
  // gated or unavailable metric never blocks the content already saved.
  // Engagement counters (likes/comments/shares) live on the post object
  // itself and are requested one field at a time; impressions/reach/
  // engagement/clicks (and, for video content, view/watch-time metrics)
  // come from /insights and are requested combined-first, then bisected
  // metric-by-metric only if the combined request is rejected.
  async fetchPagePostMetrics(
    pageAccessToken: string,
    postId: string,
    contentType: ContentType,
  ): Promise<MetricsFetchOutcome> {
    const metrics: Record<string, number | string | null> = {};
    const successfulMetrics: string[] = [];
    const failedMetrics: MetricFailure[] = [];

    const objectFieldTargets: Array<{
      metric: string;
      field: string;
      extract: (body: Record<string, unknown>) => number | undefined;
    }> = [
      {
        metric: "likes",
        field: "likes.summary(true)",
        extract: (body) => (body.likes as { summary?: { total_count?: number } } | undefined)?.summary?.total_count,
      },
      {
        metric: "comments",
        field: "comments.summary(true)",
        extract: (body) =>
          (body.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count,
      },
      {
        metric: "shares",
        field: "shares",
        extract: (body) => (body.shares as { count?: number } | undefined)?.count,
      },
    ];

    for (const target of objectFieldTargets) {
      const result = await requestFacebookField(postId, pageAccessToken, target.field);
      if (!result.ok) {
        failedMetrics.push({ metric: target.metric, reason: classifyFacebookMetricFailure(result.error) });
        continue;
      }
      const value = target.extract(result.body);
      if (typeof value === "number") {
        metrics[target.metric] = value;
        successfulMetrics.push(target.metric);
      } else {
        // No error, but the field carried no value for this post — Meta
        // omits some zero-count fields rather than returning a literal
        // zero, and we must never fabricate a value we did not receive.
        failedMetrics.push({ metric: target.metric, reason: "metricUnsupported" });
      }
    }

    const candidates = insightsMetricCandidatesFor(contentType);
    const combined = await requestFacebookInsights(postId, pageAccessToken, candidates);
    if (combined.ok) {
      for (const metric of candidates) {
        const outputName = INSIGHTS_METRIC_OUTPUT_NAMES[metric] ?? metric;
        if (combined.values.has(metric)) {
          metrics[outputName] = combined.values.get(metric)!;
          successfulMetrics.push(outputName);
        } else {
          failedMetrics.push({ metric: outputName, reason: "metricUnsupported" });
        }
      }
    } else {
      for (const metric of candidates) {
        const outputName = INSIGHTS_METRIC_OUTPUT_NAMES[metric] ?? metric;
        const single = await requestFacebookInsights(postId, pageAccessToken, [metric]);
        if (single.ok && single.values.has(metric)) {
          metrics[outputName] = single.values.get(metric)!;
          successfulMetrics.push(outputName);
        } else {
          failedMetrics.push({
            metric: outputName,
            reason: classifyFacebookMetricFailure(single.ok ? null : single.error),
          });
        }
      }
    }

    if (successfulMetrics.length === 0) {
      return {
        kind: "unsupported",
        failedMetrics,
        safeMessage: "Facebook did not return any supported metrics for this Page post.",
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
