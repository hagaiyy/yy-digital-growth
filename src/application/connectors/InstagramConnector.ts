import type {
  MetaSafeError,
  MetricFailureReason,
  MetricRecord,
  MetricsFetchOutcome,
  PlatformConnector,
  RecentContentItem,
  VerifiedIdentity,
} from "./types";
import { ConnectorError, extractMetaSafeError } from "./types";
import { mapInstagramContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { DataCompleteness, MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import type { AccountMetricRecord } from "@/domain/models/AccountPerformanceSnapshot";
import { normalizeInstagramAccountType } from "./instagram/accountType";
import {
  planInstagramAccountInsightsRequest,
  planInstagramMediaInsightsRequest,
  type AccountInsightsRequestGroup,
  type PlannedMetric,
} from "./instagram/insightsRequestPlanner";

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
  // Only meaningful for CAROUSEL_ALBUM content. Child media never gets
  // its own insights request or performance snapshot — Meta does not
  // expose meaningful child-level insights for carousel items, so only
  // the metadata is preserved on the parent content record.
  children?: { data?: Array<{ id: string; media_type?: string }> };
}

export interface InstagramTokenSet {
  accessToken: string;
  expiresAt?: string;
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

// MetricFailureReason (used by the DataImportService-facing
// MetricsFetchOutcome) and MetricRecordStatus (used by the structured,
// persisted MetricRecord) are two different closed vocabularies for the
// same underlying facts — this is the one place they're reconciled.
function toMetricRecordStatus(reason: MetricFailureReason): MetricRecordStatus {
  switch (reason) {
    case "metricUnsupported":
      return "empty";
    case "permissionMissing":
      return "permissionRequired";
    case "invalidMetricForContentType":
      return "invalidForContentType";
    case "tokenInvalid":
    case "providerError":
      return "providerError";
    case "requestRejected":
      return "unsupported";
  }
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

// Account-level insights (metric_type=total_value) return a completely
// different shape from media insights' `values` time series: a single
// scalar (`total_value.value`) for a plain aggregate, or a breakdown
// array (`total_value.breakdowns[].results[]`) for demographic metrics
// requested with a `breakdown` parameter — one result per dimension
// bucket (e.g. one per age range). Both are parsed here into one
// consistent per-metric-name list of {value, dimension?} entries so the
// caller can build AccountMetricRecords without caring which shape a
// given metric used.
interface AccountInsightsValueEntry {
  value: number;
  dimensionLabel?: string;
}

async function requestAccountInsights(
  accountId: string,
  accessToken: string,
  metricNames: string[],
  params: { period: string; since?: number; until?: number; breakdown?: string; timeframe?: string },
): Promise<
  | { ok: true; values: Map<string, AccountInsightsValueEntry[]> }
  | { ok: false; error: MetaSafeError | null }
> {
  const url = new URL(`${GRAPH_API_BASE}/${accountId}/insights`);
  url.searchParams.set("metric", metricNames.join(","));
  url.searchParams.set("period", params.period);
  url.searchParams.set("metric_type", "total_value");
  if (params.since !== undefined) url.searchParams.set("since", String(params.since));
  if (params.until !== undefined) url.searchParams.set("until", String(params.until));
  if (params.breakdown) url.searchParams.set("breakdown", params.breakdown);
  if (params.timeframe) url.searchParams.set("timeframe", params.timeframe);
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
  let body: {
    data?: Array<{
      name: string;
      total_value?: {
        value?: number;
        breakdowns?: Array<{
          results?: Array<{ dimension_values?: string[]; value?: number }>;
        }>;
      };
    }>;
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, error: null };
  }

  const values = new Map<string, AccountInsightsValueEntry[]>();
  for (const entry of body.data ?? []) {
    if (typeof entry.total_value?.value === "number") {
      values.set(entry.name, [{ value: entry.total_value.value }]);
      continue;
    }
    const results = entry.total_value?.breakdowns?.[0]?.results ?? [];
    const entries: AccountInsightsValueEntry[] = results
      .filter((result): result is { dimension_values?: string[]; value: number } => typeof result.value === "number")
      .map((result) => ({ value: result.value, dimensionLabel: result.dimension_values?.join("/") }));
    // Present in the response with zero breakdown results — Meta
    // returned the metric but had nothing to report for it (e.g. a
    // demographic metric below its documented reporting threshold),
    // never converted to a fabricated zero.
    values.set(entry.name, entries);
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
      "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,children{id,media_type}",
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

    return (body.data ?? []).map((node) => {
      // Provider values are always persisted alongside the internal
      // classification — classification uses both media_type and
      // media_product_type together, never media_type alone (see
      // mapInstagramContentType).
      const children = node.children?.data?.map((child) => ({
        id: child.id,
        mediaType: child.media_type,
      }));
      return {
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
          ...(children && children.length > 0 ? { children } : {}),
        },
      };
    });
  }

  // Every metric this connector requests for a piece of content is
  // decided by planInstagramMediaInsightsRequest against the metric
  // capability registry — never one universal list applied to every
  // media type. Within the metrics the planner says to attempt, outcomes
  // are still per-metric, never all-or-nothing: the planned list is
  // requested together first (one request, the common case whenever
  // every candidate genuinely applies); only if that combined request is
  // rejected does this fall back to requesting each metric individually,
  // so a single invalid-for-this-type or otherwise rejected metric can
  // never erase the others.
  async fetchContentMetrics(
    accessToken: string,
    externalContentId: string,
    contentType: ContentType,
    context: {
      likeCount?: number;
      commentsCount?: number;
      rawAccountType?: string;
      providerMediaType?: string;
      providerMediaProductType?: string;
    },
  ): Promise<MetricsFetchOutcome> {
    const accountType = normalizeInstagramAccountType(context.rawAccountType);
    const plan = planInstagramMediaInsightsRequest({
      accountType,
      contentType,
      grantedPermissions: OAUTH_SCOPE.split(","),
    });

    const metrics: Record<string, number | string | null> = {};
    const successfulMetrics: string[] = [];
    const failedMetrics: { metric: string; reason: MetricFailureReason }[] = [];
    const metricRecords: MetricRecord[] = [];
    // Completeness is judged only against the "expected" set: metrics
    // the registry already marks "supported" from prior live evidence.
    // A metric the registry already knows is invalid for this content
    // type (e.g. impressions for a reel) was never expected to succeed,
    // and an "untested" candidate is a speculative discovery attempt,
    // not something whose absence should ever keep an otherwise-solid
    // reel from reaching "complete" — only a previously-confirmed metric
    // actually failing counts as a real regression.
    let attemptedFailureCount = 0;

    const record = (planned: PlannedMetric, value: number | undefined, error: MetaSafeError | null | undefined) => {
      if (typeof value === "number") {
        successfulMetrics.push(planned.internalMetric);
        metrics[planned.internalMetric] = value;
        metricRecords.push({
          providerMetric: planned.providerMetric,
          internalMetric: planned.internalMetric,
          value,
          nativeUnit: planned.nativeUnit,
          status: "supported",
          period: planned.period,
          sourceEndpoint: planned.endpoint,
        });
        return;
      }
      const reason: MetricFailureReason = error ? classifyInstagramMetricFailure(error) : "metricUnsupported";
      if (planned.status === "supported") attemptedFailureCount += 1;
      failedMetrics.push({ metric: planned.internalMetric, reason });
      metricRecords.push({
        providerMetric: planned.providerMetric,
        internalMetric: planned.internalMetric,
        value: null,
        nativeUnit: planned.nativeUnit,
        status: toMetricRecordStatus(reason),
        period: planned.period,
        sourceEndpoint: planned.endpoint,
        safeReasonCode: reason,
      });
    };

    // Free metrics from content discovery — never re-requested.
    for (const planned of plan.freeMetricsFromDiscovery) {
      const value = planned.providerMetric === "like_count" ? context.likeCount : context.commentsCount;
      record(planned, value, null);
    }

    // Known in advance to be unavailable — recorded for full provenance,
    // but never actually requested.
    for (const excluded of plan.excludedMetrics) {
      failedMetrics.push({ metric: excluded.internalMetric, reason: toMetricFailureReason(excluded.reason) });
      metricRecords.push({
        providerMetric: excluded.providerMetric,
        internalMetric: excluded.internalMetric,
        value: null,
        nativeUnit: excluded.nativeUnit,
        status: excluded.reason,
        sourceEndpoint: excluded.endpoint,
        safeReasonCode: excluded.reason,
      });
    }

    const combinable = plan.metricsToRequest;
    if (combinable.length > 0) {
      const combined = await requestInsights(
        externalContentId,
        accessToken,
        combinable.map((m) => m.providerMetric),
      );
      if (combined.ok) {
        for (const planned of combinable) {
          record(planned, combined.values.get(planned.providerMetric), null);
        }
      } else {
        for (const planned of combinable) {
          const single = await requestInsights(externalContentId, accessToken, [planned.providerMetric]);
          record(planned, single.ok ? single.values.get(planned.providerMetric) : undefined, single.ok ? null : single.error);
        }
      }
    }

    // Metrics the registry has proven need their own request regardless
    // of the combined call's outcome (none confirmed yet — see
    // MediaInsightsPlan.independentMetrics).
    for (const planned of plan.independentMetrics) {
      const single = await requestInsights(externalContentId, accessToken, [planned.providerMetric]);
      record(planned, single.ok ? single.values.get(planned.providerMetric) : undefined, single.ok ? null : single.error);
    }

    if (successfulMetrics.length === 0) {
      const nothingWasEverAttempted =
        combinable.length === 0 && plan.independentMetrics.length === 0 && plan.freeMetricsFromDiscovery.length === 0;
      return {
        kind: "unsupported",
        failedMetrics,
        safeMessage: nothingWasEverAttempted
          ? "Instagram has no known or documented performance metric for this content type yet."
          : "Instagram does not provide performance metrics for this content.",
        dataCompleteness: nothingWasEverAttempted ? "untested" : "unavailable",
        metricRecords,
        accountType,
        providerMediaType: context.providerMediaType,
        providerMediaProductType: context.providerMediaProductType,
      };
    }

    return {
      kind: "success",
      metrics,
      successfulMetrics,
      failedMetrics,
      dataCompleteness: attemptedFailureCount === 0 ? "complete" : "partial",
      metricRecords,
      accountType,
      providerMediaType: context.providerMediaType,
      providerMediaProductType: context.providerMediaProductType,
    };
  }

  // Account-level insights are always requested independently per Meta
  // request-parameter group (see planInstagramAccountInsightsRequest) —
  // never as one universal call — and every group is attempted even if
  // an earlier one failed entirely, so one broken group (e.g. a
  // demographics call rejected for account-size reasons) never blocks
  // another platform, another connection, or the rest of the import.
  //
  // `referenceHourIso` is the caller's truncated snapshotHour, never a
  // fresh `new Date()` read here — since/until must be a pure function
  // of the hour being collected, so two imports within the same UTC
  // hour compute the identical date range and correctly update the same
  // stored snapshot instead of each creating a new one.
  async fetchAccountInsights(
    accessToken: string,
    accountId: string,
    rawAccountType: string | undefined,
    referenceHourIso: string,
  ): Promise<AccountInsightsGroupResult[]> {
    const accountType = normalizeInstagramAccountType(rawAccountType);
    const plan = planInstagramAccountInsightsRequest({
      accountType,
      grantedPermissions: OAUTH_SCOPE.split(","),
    });

    const results: AccountInsightsGroupResult[] = [];

    for (const group of plan.requestGroups) {
      const requestParams: { period: string; since?: number; until?: number; breakdown?: string; timeframe?: string } = {
        period: group.period,
        breakdown: group.breakdown,
        timeframe: group.timeframe,
      };
      if (group.requiresDateRange) {
        const until = new Date(referenceHourIso);
        const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
        requestParams.since = Math.floor(since.getTime() / 1000);
        requestParams.until = Math.floor(until.getTime() / 1000);
      }

      // Combined-first, bisected on failure — identical pattern to media
      // insights: one grouped call whenever every metric in the group
      // genuinely applies, falling back to one request per metric only
      // when the combined call itself is rejected, so a single bad
      // metric can never take down the rest of its group.
      const combined = await requestAccountInsights(
        accountId,
        accessToken,
        group.metrics.map((m) => m.providerMetric),
        requestParams,
      );

      let metrics: AccountMetricRecord[];
      if (combined.ok) {
        metrics = group.metrics.flatMap((planned) =>
          accountMetricRecordsFor(planned, group, combined.values.get(planned.providerMetric)),
        );
      } else {
        metrics = [];
        for (const planned of group.metrics) {
          const single = await requestAccountInsights(accountId, accessToken, [planned.providerMetric], requestParams);
          if (!single.ok) {
            const reason = classifyInstagramMetricFailure(single.error);
            metrics.push({
              providerMetric: planned.providerMetric,
              internalMetric: planned.internalMetric,
              value: null,
              nativeUnit: planned.nativeUnit,
              status: toMetricRecordStatus(reason),
              period: group.period,
              breakdown: group.breakdown,
              timeframe: group.timeframe,
              sourceEndpoint: planned.endpoint,
              safeReasonCode: reason,
            });
            continue;
          }
          metrics.push(...accountMetricRecordsFor(planned, group, single.values.get(planned.providerMetric)));
        }
      }

      // Counted by distinct provider metric, not by record — a
      // demographic metric can expand into several records (one per
      // dimension bucket), which must never inflate the denominator
      // past the number of metrics actually planned for this group.
      const successfulProviderMetrics = new Set(
        metrics.filter((m) => m.status === "supported").map((m) => m.providerMetric),
      );
      const completeness: DataCompleteness =
        successfulProviderMetrics.size === 0
          ? "unavailable"
          : successfulProviderMetrics.size === group.metrics.length
            ? "complete"
            : "partial";

      results.push({
        period: group.period,
        since: requestParams.since !== undefined ? new Date(requestParams.since * 1000).toISOString() : undefined,
        until: requestParams.until !== undefined ? new Date(requestParams.until * 1000).toISOString() : undefined,
        timeframe: group.timeframe,
        breakdown: group.breakdown,
        completeness,
        metrics,
      });
    }

    return results;
  }
}

// Converts one metric's raw result entries (already parsed by
// requestAccountInsights) into one or more AccountMetricRecords —
// several for a demographic metric with multiple dimension buckets, one
// with status "empty" (never a fabricated zero) if Meta returned the
// metric but nothing to report for it, and one with status "empty" if
// the metric was entirely absent from the response.
function accountMetricRecordsFor(
  planned: PlannedMetric,
  group: AccountInsightsRequestGroup,
  entries: AccountInsightsValueEntry[] | undefined,
): AccountMetricRecord[] {
  const base = {
    providerMetric: planned.providerMetric,
    nativeUnit: planned.nativeUnit,
    period: group.period,
    breakdown: group.breakdown,
    timeframe: group.timeframe,
    sourceEndpoint: planned.endpoint,
  };
  if (entries === undefined) {
    return [{ ...base, internalMetric: planned.internalMetric, value: null, status: "empty", safeReasonCode: "metricUnsupported" }];
  }
  if (entries.length === 0) {
    return [
      {
        ...base,
        internalMetric: planned.internalMetric,
        value: null,
        status: "empty",
        unavailableDueToAccountSize: group.breakdown !== undefined,
      },
    ];
  }
  return entries.map((valueEntry) => ({
    ...base,
    internalMetric: valueEntry.dimensionLabel ? `${planned.internalMetric}:${valueEntry.dimensionLabel}` : planned.internalMetric,
    value: valueEntry.value,
    status: "supported" as const,
  }));
}

export interface AccountInsightsGroupResult {
  period: string;
  since?: string;
  until?: string;
  timeframe?: string;
  breakdown?: string;
  completeness: DataCompleteness;
  metrics: AccountMetricRecord[];
}

function toMetricFailureReason(status: MetricRecordStatus): MetricFailureReason {
  switch (status) {
    case "permissionRequired":
      return "permissionMissing";
    case "invalidForContentType":
      return "invalidMetricForContentType";
    case "deprecated":
    case "unsupported":
    case "accessReviewRequired":
      return "requestRejected";
    case "empty":
    case "untested":
      return "metricUnsupported";
    case "providerError":
    default:
      return "providerError";
  }
}
