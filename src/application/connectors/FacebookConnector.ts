import type { MetricsFetchOutcome, PlatformConnector, RecentContentItem, VerifiedIdentity } from "./types";
import { ConnectorError } from "./types";
import { mapFacebookContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

// Read-only scope only: no publishing, advertising, or unrelated
// permission is requested. `read_insights` is deliberately not
// requested — Meta rejects it for this app with "Invalid Scopes", and
// Page post metrics already degrade to an "unsupported" result (see
// fetchPagePostMetrics below) rather than depending on it.
const OAUTH_SCOPE = "public_profile,pages_show_list,pages_read_engagement";

interface FacebookPostNode {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data?: Array<{ type?: string; media_type?: string }> };
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
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

  // The Graph API does not provide personal-profile feed content or
  // analytics to standard (non-extended-review) apps — `user_posts` is
  // restricted. Reporting this as unsupported up front, without an API
  // call, is more honest than attempting a request that cannot succeed.
  fetchAccountContent(): { items: RecentContentItem[]; safeMessage: string } {
    return {
      items: [],
      safeMessage:
        "Facebook does not provide personal-profile content or analytics through the public API for this connection type.",
    };
  }

  async fetchPageContent(
    pageAccessToken: string,
    pageId: string,
    limit: number,
  ): Promise<RecentContentItem[]> {
    const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
    url.searchParams.set(
      "fields",
      "id,message,created_time,permalink_url,full_picture,attachments{type,media_type},likes.summary(true),comments.summary(true),shares",
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
          likes_count: node.likes?.summary?.total_count,
          comments_count: node.comments?.summary?.total_count,
          shares_count: node.shares?.count,
        },
      };
    });
  }

  async fetchPagePostMetrics(
    pageAccessToken: string,
    postId: string,
    knownEngagement: { likesCount?: number; commentsCount?: number; sharesCount?: number },
  ): Promise<MetricsFetchOutcome> {
    const url = new URL(`${GRAPH_API_BASE}/${postId}/insights`);
    url.searchParams.set(
      "metric",
      "post_impressions,post_impressions_unique,post_engaged_users,post_clicks",
    );
    url.searchParams.set("access_token", pageAccessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      return { kind: "failed", safeMessage: "Facebook could not be reached to retrieve Page post metrics." };
    }

    if (!response.ok) {
      return {
        kind: "unsupported",
        safeMessage: "Facebook does not provide insights for this Page post.",
      };
    }

    let body: { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { kind: "failed", safeMessage: "Facebook returned an unexpected metrics response." };
    }

    const raw = new Map<string, number>();
    for (const entry of body.data ?? []) {
      const value = entry.values?.[0]?.value;
      if (typeof value === "number") raw.set(entry.name, value);
    }

    const requested = ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_clicks"];
    const metrics: Record<string, number | string | null> = {
      likes: knownEngagement.likesCount ?? null,
      comments: knownEngagement.commentsCount ?? null,
      shares: knownEngagement.sharesCount ?? null,
    };
    if (raw.has("post_impressions")) metrics.impressions = raw.get("post_impressions")!;
    if (raw.has("post_impressions_unique")) metrics.reach = raw.get("post_impressions_unique")!;
    if (raw.has("post_engaged_users")) metrics.engagements = raw.get("post_engaged_users")!;
    if (raw.has("post_clicks")) metrics.linkClicks = raw.get("post_clicks")!;

    const dataCompleteness = raw.size >= requested.length ? "complete" : "partial";
    return { kind: "success", metrics, dataCompleteness };
  }
}
