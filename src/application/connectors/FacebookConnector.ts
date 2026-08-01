import type {
  MetaSafeError,
  MetricFailure,
  MetricFailureReason,
  MetricRecord,
  MetricsFetchOutcome,
  PlatformConnector,
  RecentContentItem,
  VerifiedIdentity,
} from "./types";
import { ConnectorError, extractMetaSafeError } from "./types";
import { mapFacebookContentType } from "@/application/mapping/contentTypeMapping";
import { isPlaceholderValue } from "@/config/localSetupVariables";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { DataCompleteness, MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";
import type { AccountMetricRecord } from "@/domain/models/AccountPerformanceSnapshot";
import {
  planFacebookPageInsightsRequest,
  planFacebookPostInsightsRequest,
  type PlannedMetric,
} from "./facebook/insightsRequestPlanner";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

// Read-only scope only: no publishing, moderation, messaging, ads,
// webhook, or personal-profile permission is requested. `read_insights`
// and `pages_read_user_content` were each added once the Meta Developer
// app marked them "Ready for testing" — `pages_read_user_content` is
// specifically what live isolation testing proved likes.summary/
// comments.summary need (both rejected with OAuthException code=10
// under pages_read_engagement + read_insights alone; see the metric
// capability registry). `business_management` is deliberately not
// requested: fetchManagedPages only ever calls GET /me/accounts, which
// needs no Business Manager permission.
const OAUTH_SCOPE =
  "public_profile,pages_show_list,pages_read_engagement,pages_read_user_content,read_insights";

// Stage A (content discovery) fields only — see fetchPageContent.
// Engagement summary fields (likes/comments) are fetched independently,
// per post, in fetchPagePostMetrics instead, so one gated or rejected
// field there can never block post identity import. `status_type` is
// the only documented signal for a post with no attachment at all (a
// plain text status update) — the legacy `type` field is deliberately
// never requested: live-tested and confirmed rejected with
// OAuthException code=12 ("deprecated") for this app's Page token.
interface FacebookPostNode {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data?: Array<{ type?: string; media_type?: string }> };
  status_type?: string;
}

export interface FacebookManagedPage {
  id: string;
  name: string;
  category?: string;
  accessToken: string;
}

// Only safe validity/permission facts — never a token, secret, or the
// raw debug_token response body.
export interface FacebookTokenVerificationResult {
  userToken: {
    valid: boolean;
    belongsToApp: boolean;
    hasReadInsights: boolean;
    hasPagesReadEngagement: boolean;
    hasPagesReadUserContent: boolean;
  };
  pageToken: {
    valid: boolean;
    belongsToApp: boolean;
    belongsToExpectedPage: boolean;
  };
  pageIdMatches: boolean;
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

async function requestFacebookPageInsights(
  pageId: string,
  pageAccessToken: string,
  metricNames: string[],
  period: string,
): Promise<{ ok: true; values: Map<string, number> } | { ok: false; error: MetaSafeError | null }> {
  const url = new URL(`${GRAPH_API_BASE}/${pageId}/insights`);
  url.searchParams.set("metric", metricNames.join(","));
  url.searchParams.set("period", period);
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

// Extracts only safe, structured facts from Meta's /debug_token
// response — is_valid, which app it belongs to, and the granted
// permission names (both the flat `scopes` array and each
// `granular_scopes[].scope`, since a permission consented to under
// Meta's granular-permissions flow can appear only in the latter). The
// raw response body is discarded once these are read; a token-debug
// response is never itself returned or logged, per this app's rule
// that a permission appearing here is not proof a metric will actually
// work — only a real production response proves that.
interface DebugTokenSafeResult {
  isValid: boolean;
  belongsToApp: boolean;
  scopes: string[];
}

async function debugToken(
  inputToken: string,
  appId: string,
  appSecret: string,
): Promise<DebugTokenSafeResult | null> {
  const url = new URL(`${GRAPH_API_BASE}/debug_token`);
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const body = (await response.json()) as {
      data?: {
        app_id?: string;
        is_valid?: boolean;
        scopes?: string[];
        granular_scopes?: Array<{ scope?: string }>;
      };
    };
    const data = body.data;
    if (!data) return null;
    const scopeSet = new Set<string>(data.scopes ?? []);
    for (const granular of data.granular_scopes ?? []) {
      if (granular.scope) scopeSet.add(granular.scope);
    }
    return {
      isValid: data.is_valid === true,
      belongsToApp: data.app_id === appId,
      scopes: Array.from(scopeSet),
    };
  } catch {
    return null;
  }
}

// MetricFailureReason (used by the DataImportService-facing
// MetricsFetchOutcome) and MetricRecordStatus (used by the structured,
// persisted MetricRecord/AccountMetricRecord) are two different closed
// vocabularies for the same underlying facts — this is the one place
// they're reconciled, mirroring InstagramConnector's own
// toMetricRecordStatus/toMetricFailureReason pair.
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

// Extracts the value for one object-field engagement counter from the
// raw GET /{post-id}?fields=... response. Kept as one small dispatch
// table rather than several near-identical inline closures.
function extractObjectFieldValue(providerMetric: string, body: Record<string, unknown>): number | undefined {
  if (providerMetric === "likes.summary(true)") {
    return (body.likes as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  }
  if (providerMetric === "comments.summary(true)") {
    return (body.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  }
  if (providerMetric === "shares") {
    return (body.shares as { count?: number } | undefined)?.count;
  }
  return undefined;
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

  // Server-side proof of real token/permission state — never inferred
  // from what was requested at authorization time, and never treated as
  // proof that a specific metric will work (only a real production
  // response proves that; see fetchPagePostMetrics/fetchPageInsights).
  // "Belongs to expected Page" is proven by actually calling GET
  // /{expectedPageId} with the Page token: a Page-scoped token can only
  // read its own Page, so this fails for any token/Page mismatch.
  async verifyTokenState(
    userAccessToken: string,
    pageAccessToken: string,
    expectedPageId: string,
  ): Promise<FacebookTokenVerificationResult> {
    const config = getConfig();
    if (!config) {
      throw new ConnectorError(
        "setupRequired",
        `Facebook is not configured. Missing environment variable(s): ${missingFacebookConfigVars().join(", ")}.`,
      );
    }

    const [userDebug, pageDebug, pageIdentity] = await Promise.all([
      debugToken(userAccessToken, config.appId, config.appSecret),
      debugToken(pageAccessToken, config.appId, config.appSecret),
      this.verifyPageStillManaged(expectedPageId, pageAccessToken).catch(() => null),
    ]);

    const pageBelongsToExpectedPage = pageIdentity !== null && pageIdentity.externalAccountId === expectedPageId;

    return {
      userToken: {
        valid: userDebug?.isValid ?? false,
        belongsToApp: userDebug?.belongsToApp ?? false,
        hasReadInsights: userDebug?.scopes.includes("read_insights") ?? false,
        hasPagesReadEngagement: userDebug?.scopes.includes("pages_read_engagement") ?? false,
        hasPagesReadUserContent: userDebug?.scopes.includes("pages_read_user_content") ?? false,
      },
      pageToken: {
        valid: pageDebug?.isValid ?? false,
        belongsToApp: pageDebug?.belongsToApp ?? false,
        belongsToExpectedPage: pageBelongsToExpectedPage,
      },
      pageIdMatches: pageBelongsToExpectedPage,
    };
  }

  async fetchPageContent(
    pageAccessToken: string,
    pageId: string,
    limit: number,
  ): Promise<RecentContentItem[]> {
    const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
    // Stage A — content discovery only, safe metadata never gated behind
    // an engagement-summary permission. id, created_time, message,
    // permalink_url, attachments{type,media_type}, full_picture,
    // status_type are proven safe by live isolation testing
    // (facebookPageFields / facebook-fields-diagnostic): all either
    // supported or merely empty, never rejected. The legacy `type` field
    // is deliberately excluded — live-tested and confirmed rejected with
    // OAuthException code=12 ("this field is deprecated") for this app's
    // Page token, on 2026-08-01, after being added without independent
    // testing first and taking the entire Page connection down.
    // likes.summary/comments.summary are deliberately never requested
    // here either — they are proven to require a permission this app's
    // Page token does not always have and are fetched independently, per
    // post, in fetchPagePostMetrics instead.
    url.searchParams.set(
      "fields",
      "id,created_time,message,permalink_url,attachments{type,media_type},full_picture,status_type",
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
        // The legacy `type` field is never requested (see above) — its
        // provider-type argument is always undefined, and classification
        // falls through to attachments and status_type only.
        contentType: mapFacebookContentType(attachment?.type, attachment?.media_type, undefined, node.status_type),
        caption: node.message ?? null,
        permalink: node.permalink_url ?? null,
        thumbnailUrl: node.full_picture ?? null,
        publishedAt: node.created_time ?? null,
        platformData: {
          attachment_type: attachment?.type,
          attachment_media_type: attachment?.media_type,
          provider_status_type: node.status_type,
        },
      };
    });
  }

  // Stage B — per-post metrics, fetched independently of Stage A so one
  // gated or unavailable metric never blocks the content already saved.
  // Every metric requested is decided by planFacebookPostInsightsRequest
  // against the metric capability registry — never one universal list
  // applied to every content type. Engagement counters (likes/comments/
  // shares) live on the post object itself and are always requested one
  // field at a time (proven necessary: a rejected field must never take
  // another down with it); distribution/performance/video metrics come
  // from /insights and are requested combined-first, then bisected
  // metric-by-metric only if the combined request is rejected.
  async fetchPagePostMetrics(
    pageAccessToken: string,
    postId: string,
    contentType: ContentType,
    providerObjectType?: string,
  ): Promise<MetricsFetchOutcome> {
    const plan = planFacebookPostInsightsRequest({ contentType, grantedPermissions: OAUTH_SCOPE.split(",") });

    const metrics: Record<string, number | string | null> = {};
    const successfulMetrics: string[] = [];
    const failedMetrics: MetricFailure[] = [];
    const metricRecords: MetricRecord[] = [];
    let attemptedCount = 0;
    let attemptedFailureCount = 0;

    const record = (planned: PlannedMetric, value: number | undefined, error: MetaSafeError | null | undefined) => {
      attemptedCount += 1;
      if (typeof value === "number") {
        successfulMetrics.push(planned.internalMetric);
        metrics[planned.internalMetric] = value;
        metricRecords.push({
          providerMetric: planned.providerMetric,
          internalMetric: planned.internalMetric,
          value,
          nativeUnit: planned.nativeUnit,
          status: "available",
          period: planned.period,
          sourceEndpoint: planned.endpoint,
        });
        return;
      }
      attemptedFailureCount += 1;
      // No error, but the field/metric carried no value for this post —
      // Meta omits some zero-count fields rather than returning a
      // literal zero, and we must never fabricate a value we did not
      // receive.
      const reason: MetricFailureReason = error ? classifyFacebookMetricFailure(error) : "metricUnsupported";
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

    // Known in advance (mostly Meta's June 2026 Page Insights
    // deprecations) — recorded for provenance, never actually requested.
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

    for (const planned of plan.objectFieldMetrics) {
      const result = await requestFacebookField(postId, pageAccessToken, planned.providerMetric);
      if (!result.ok) {
        record(planned, undefined, result.error);
        continue;
      }
      record(planned, extractObjectFieldValue(planned.providerMetric, result.body), null);
    }

    if (plan.insightsMetrics.length > 0) {
      const combined = await requestFacebookInsights(
        postId,
        pageAccessToken,
        plan.insightsMetrics.map((m) => m.providerMetric),
      );
      if (combined.ok) {
        for (const planned of plan.insightsMetrics) {
          record(planned, combined.values.get(planned.providerMetric), null);
        }
      } else {
        for (const planned of plan.insightsMetrics) {
          const single = await requestFacebookInsights(postId, pageAccessToken, [planned.providerMetric]);
          record(planned, single.ok ? single.values.get(planned.providerMetric) : undefined, single.ok ? null : single.error);
        }
      }
    }
    for (const planned of plan.independentInsightsMetrics) {
      const single = await requestFacebookInsights(postId, pageAccessToken, [planned.providerMetric]);
      record(planned, single.ok ? single.values.get(planned.providerMetric) : undefined, single.ok ? null : single.error);
    }

    if (successfulMetrics.length === 0) {
      const nothingWasEverAttempted = attemptedCount === 0;
      return {
        kind: "unsupported",
        failedMetrics,
        safeMessage: nothingWasEverAttempted
          ? "Facebook has no known or documented performance metric for this content type yet."
          : "Facebook did not return any supported metrics for this Page post.",
        dataCompleteness: nothingWasEverAttempted ? "untested" : "unavailable",
        metricRecords,
        providerObjectType,
      };
    }
    return {
      kind: "success",
      metrics,
      successfulMetrics,
      failedMetrics,
      dataCompleteness: attemptedFailureCount === 0 ? "complete" : "partial",
      metricRecords,
      providerObjectType,
    };
  }

  // Page-level insights, always requested independently of any post's
  // metrics and never mixed into a post-level snapshot — Meta's Page
  // Insights endpoint describes the whole Page, not one piece of
  // content. Combined-first, bisected metric-by-metric only if the
  // combined call is rejected, mirroring fetchPagePostMetrics.
  async fetchPageInsights(
    pageAccessToken: string,
    pageId: string,
  ): Promise<{ period: string; completeness: DataCompleteness; metrics: AccountMetricRecord[] }> {
    const plan = planFacebookPageInsightsRequest({ grantedPermissions: OAUTH_SCOPE.split(",") });

    const metrics: AccountMetricRecord[] = [];
    let attemptedCount = 0;
    let successCount = 0;

    const record = (planned: PlannedMetric, value: number | undefined, error: MetaSafeError | null | undefined) => {
      attemptedCount += 1;
      if (typeof value === "number") {
        successCount += 1;
        metrics.push({
          providerMetric: planned.providerMetric,
          internalMetric: planned.internalMetric,
          value,
          nativeUnit: planned.nativeUnit,
          status: "available",
          period: planned.period,
          sourceEndpoint: planned.endpoint,
        });
        return;
      }
      const reason: MetricFailureReason = error ? classifyFacebookMetricFailure(error) : "metricUnsupported";
      metrics.push({
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

    for (const excluded of plan.excludedMetrics) {
      metrics.push({
        providerMetric: excluded.providerMetric,
        internalMetric: excluded.internalMetric,
        value: null,
        nativeUnit: excluded.nativeUnit,
        status: excluded.reason,
        sourceEndpoint: excluded.endpoint,
        safeReasonCode: excluded.reason,
      });
    }

    if (plan.metrics.length > 0) {
      const combined = await requestFacebookPageInsights(
        pageId,
        pageAccessToken,
        plan.metrics.map((m) => m.providerMetric),
        plan.period,
      );
      if (combined.ok) {
        for (const planned of plan.metrics) {
          record(planned, combined.values.get(planned.providerMetric), null);
        }
      } else {
        for (const planned of plan.metrics) {
          const single = await requestFacebookPageInsights(pageId, pageAccessToken, [planned.providerMetric], plan.period);
          record(planned, single.ok ? single.values.get(planned.providerMetric) : undefined, single.ok ? null : single.error);
        }
      }
    }

    const completeness: DataCompleteness =
      attemptedCount === 0 ? "untested" : successCount === 0 ? "unavailable" : successCount === attemptedCount ? "complete" : "partial";

    return { period: plan.period, completeness, metrics };
  }
}
