import type { MetricsFetchOutcome, PlatformConnector, RecentContentItem, VerifiedIdentity } from "./types";
import { ConnectorError } from "./types";
import { mapPinterestContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";

const AUTHORIZATION_BASE = "https://www.pinterest.com/oauth/";
const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
const USER_ACCOUNT_URL = "https://api.pinterest.com/v5/user_account";
const PINS_URL = "https://api.pinterest.com/v5/pins";

// Read-only scope. `pins:read` was added in the Data Import phase so
// Pins can be listed and their analytics read; any Pinterest account
// connected under the previous, narrower `user_accounts:read`-only
// scope must be reconnected to gain content-import permission.
const OAUTH_SCOPE = "user_accounts:read,pins:read";

interface PinterestPinNode {
  id: string;
  title?: string;
  description?: string;
  link?: string;
  created_at?: string;
  media?: { media_type?: string; images?: Record<string, { url?: string }> };
}

export interface PinterestTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

function getConfig() {
  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) return null;
  // A placeholder/test value must never be treated as real
  // configuration — that would send the user into a live OAuth redirect
  // that is guaranteed to fail.
  if (isPlaceholderValue(appId) || isPlaceholderValue(appSecret)) return null;
  return { appId, appSecret, redirectUri };
}

// Names only — never a value.
function missingPinterestConfigVars(): string[] {
  const missing: string[] = [];
  if (!process.env.PINTEREST_APP_ID || isPlaceholderValue(process.env.PINTEREST_APP_ID)) missing.push("PINTEREST_APP_ID");
  if (!process.env.PINTEREST_APP_SECRET || isPlaceholderValue(process.env.PINTEREST_APP_SECRET)) missing.push("PINTEREST_APP_SECRET");
  if (!process.env.PINTEREST_REDIRECT_URI) missing.push("PINTEREST_REDIRECT_URI");
  return missing;
}

async function parseJsonOrThrow<T>(response: Response, safeMessage: string): Promise<T> {
  if (!response.ok) {
    throw new ConnectorError("failed", safeMessage);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ConnectorError("failed", "Pinterest returned an unexpected response.");
  }
}

// Module-scoped rather than a private class method: a `private` method
// would make PinterestConnector nominally typed, which breaks
// structural compatibility with the fake connector used in tests.
async function requestToken(params: Record<string, string>): Promise<PinterestTokenSet> {
  const config = getConfig();
  if (!config) {
    throw new ConnectorError(
      "setupRequired",
      `Pinterest is not configured. Missing environment variable(s): ${missingPinterestConfigVars().join(", ")}.`,
    );
  }
  const basicAuth = Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new ConnectorError("failed", "Pinterest could not be reached to complete authorization.");
  }

  const body = await parseJsonOrThrow<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>(response, "Pinterest rejected the authorization request.");

  if (!body.access_token) {
    throw new ConnectorError("failed", "Pinterest did not return an access token.");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : undefined,
  };
}

export class PinterestConnector implements PlatformConnector {
  readonly platform = "pinterest" as const;

  isConfigured(): boolean {
    return getConfig() !== null;
  }

  getMissingConfigVars(): string[] {
    return missingPinterestConfigVars();
  }

  buildAuthorizationUrl(state: string): string {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Pinterest is not configured. Missing environment variable(s): ${missingPinterestConfigVars().join(", ")}.`,
      );
    }
    const url = new URL(AUTHORIZATION_BASE);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string): Promise<PinterestTokenSet> {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Pinterest is not configured. Missing environment variable(s): ${missingPinterestConfigVars().join(", ")}.`,
      );
    }
    return requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<PinterestTokenSet> {
    if (!this.isConfigured()) {
      throw new ConnectorError(
        "setupRequired",
        `Pinterest is not configured. Missing environment variable(s): ${missingPinterestConfigVars().join(", ")}.`,
      );
    }
    return requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async fetchIdentity(accessToken: string): Promise<VerifiedIdentity> {
    let response: Response;
    try {
      response = await fetch(USER_ACCOUNT_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new ConnectorError("failed", "Pinterest could not be reached to verify identity.");
    }
    const body = await parseJsonOrThrow<{
      username?: string;
      account_type?: string;
    }>(response, "Pinterest rejected the account verification request.");

    if (!body.username) {
      throw new ConnectorError("failed", "Pinterest did not return an account identity.");
    }

    return {
      externalAccountId: body.username,
      displayName: body.username,
      accountType: body.account_type,
      grantedScopes: [OAUTH_SCOPE],
    };
  }

  async fetchRecentPins(accessToken: string, limit: number): Promise<RecentContentItem[]> {
    const url = new URL(PINS_URL);
    url.searchParams.set("page_size", String(limit));

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new ConnectorError("failed", "Pinterest could not be reached to retrieve recent Pins.");
    }
    const body = await parseJsonOrThrow<{ items?: PinterestPinNode[] }>(
      response,
      "Pinterest rejected the recent-Pins request.",
    );

    return (body.items ?? []).map((node) => {
      const images = node.media?.images ?? {};
      const thumbnailUrl = Object.values(images)[0]?.url ?? null;
      return {
        externalContentId: node.id,
        contentType: mapPinterestContentType(node.media?.media_type),
        title: node.title ?? null,
        caption: node.description ?? null,
        permalink: `https://www.pinterest.com/pin/${node.id}/`,
        thumbnailUrl,
        publishedAt: node.created_at ?? null,
        platformData: {
          media_type: node.media?.media_type,
          destination_url: node.link,
        },
      };
    });
  }

  async fetchPinAnalytics(accessToken: string, pinId: string): Promise<MetricsFetchOutcome> {
    const today = new Date();
    const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);

    const url = new URL(`${PINS_URL}/${pinId}/analytics`);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("metric_types", "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      return { kind: "failed", safeMessage: "Pinterest could not be reached to retrieve Pin analytics." };
    }

    if (response.status === 403 || response.status === 401) {
      return {
        kind: "unsupported",
        failedMetrics: [],
        safeMessage: "Pinterest analytics are not available for this account.",
      };
    }
    if (!response.ok) {
      return { kind: "failed", safeMessage: "Pinterest rejected the Pin analytics request." };
    }

    let body: {
      all?: { summary_metrics?: Record<string, number> };
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { kind: "failed", safeMessage: "Pinterest returned an unexpected analytics response." };
    }

    const summary = body.all?.summary_metrics ?? {};
    const requested = ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"];
    const metrics: Record<string, number | string | null> = {};
    if ("IMPRESSION" in summary) metrics.impressions = summary.IMPRESSION!;
    if ("SAVE" in summary) metrics.saves = summary.SAVE!;
    if ("PIN_CLICK" in summary) metrics.pinClicks = summary.PIN_CLICK!;
    if ("OUTBOUND_CLICK" in summary) metrics.outboundClicks = summary.OUTBOUND_CLICK!;

    const foundKeys = requested.filter((key) => key in summary);
    const missingKeys = requested.filter((key) => !(key in summary));
    if (foundKeys.length === 0) {
      return {
        kind: "unsupported",
        failedMetrics: missingKeys.map((metric) => ({ metric, reason: "metricUnsupported" as const })),
        safeMessage: "Pinterest did not return any analytics for this Pin.",
      };
    }
    const dataCompleteness = foundKeys.length >= requested.length ? "complete" : "partial";
    return {
      kind: "success",
      metrics,
      successfulMetrics: foundKeys,
      failedMetrics: missingKeys.map((metric) => ({ metric, reason: "metricUnsupported" as const })),
      dataCompleteness,
    };
  }
}
