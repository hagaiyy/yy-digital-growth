import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { CONNECTION_IDS } from "@/domain/connectionIds";

// Temporary, production-safe, read-only diagnostic used to determine
// real Meta API capability before writing any fix — never guesses.
// Uses the existing encrypted credentials server-side. Never returns a
// token, secret, account name, or raw provider payload — only safe,
// structured outcomes (ok/empty/rejected + Meta's own type/code/subcode).
//
// Three independent diagnostics, each requested via ?check=:
//   facebookPageFields   — Part 1: isolate each /{pageId}/posts field
//   instagramMetrics     — Part 3: isolate each Instagram insights metric
//   facebookAccountPosts — Part 5: live GET /me/posts capability test

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const IG_GRAPH_API_BASE = "https://graph.instagram.com";

interface MetaErrorShape {
  type?: string;
  code?: number;
  error_subcode?: number;
}

function safeError(error: MetaErrorShape | null) {
  if (!error) return null;
  return { type: error.type ?? null, code: error.code ?? null, subcode: error.error_subcode ?? null };
}

async function safeGet(url: URL): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: MetaErrorShape | null; httpStatus: number }> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    return { ok: false, error: null, httpStatus: 0 };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // ignore — body stays {}
  }
  if (!response.ok) {
    return { ok: false, error: (body.error as MetaErrorShape) ?? null, httpStatus: response.status };
  }
  return { ok: true, body };
}

// ---- Facebook Page field isolation (Part 1) ----

const FACEBOOK_PAGE_FIELDS_TO_TEST: Array<{ name: string; fieldExpr: string }> = [
  { name: "message", fieldExpr: "message" },
  { name: "permalink_url", fieldExpr: "permalink_url" },
  { name: "full_picture", fieldExpr: "full_picture" },
  { name: "attachments", fieldExpr: "attachments{type,media_type}" },
  { name: "likes.summary", fieldExpr: "likes.summary(true)" },
  { name: "comments.summary", fieldExpr: "comments.summary(true)" },
  { name: "shares", fieldExpr: "shares" },
];

async function testFacebookPageFields(pageId: string, pageAccessToken: string) {
  const results: Array<{
    field: string;
    outcome: "supported" | "empty" | "rejected";
    error: ReturnType<typeof safeError>;
  }> = [];

  const baselineUrl = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
  baselineUrl.searchParams.set("fields", "id,created_time");
  baselineUrl.searchParams.set("limit", "1");
  baselineUrl.searchParams.set("access_token", pageAccessToken);
  const baseline = await safeGet(baselineUrl);
  results.push({
    field: "id,created_time (baseline)",
    outcome: baseline.ok ? "supported" : "rejected",
    error: baseline.ok ? null : safeError(baseline.error),
  });

  for (const field of FACEBOOK_PAGE_FIELDS_TO_TEST) {
    const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
    url.searchParams.set("fields", `id,created_time,${field.fieldExpr}`);
    url.searchParams.set("limit", "1");
    url.searchParams.set("access_token", pageAccessToken);
    const result = await safeGet(url);
    if (!result.ok) {
      results.push({ field: field.name, outcome: "rejected", error: safeError(result.error) });
      continue;
    }
    const data = (result.body.data as Array<Record<string, unknown>> | undefined) ?? [];
    const hasAnyValue = data.some((post) => {
      const key = field.name.split(".")[0]!;
      return post[key] !== undefined && post[key] !== null;
    });
    results.push({ field: field.name, outcome: hasAnyValue ? "supported" : "empty", error: null });
  }

  return results;
}

// ---- Instagram metric isolation (Parts 3 & 4) ----

const KNOWN_INSTAGRAM_IDS = ["17897479950464953", "17854170132680768", "17947772712188757"];

const CANDIDATE_INSTAGRAM_METRICS = [
  "impressions",
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "plays",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
  "video_views",
  "follows",
  "profile_activity",
  "navigation",
];

async function testInstagramMetrics(accessToken: string) {
  const results: Array<{
    contentId: string;
    mediaType: string | null;
    mediaProductType: string | null;
    combinedRequestOutcome: "ok" | "rejected";
    combinedRequestError: ReturnType<typeof safeError>;
    perMetric: Array<{ metric: string; outcome: "supported" | "empty" | "rejected"; error: ReturnType<typeof safeError> }>;
  }> = [];

  for (const contentId of KNOWN_INSTAGRAM_IDS) {
    const nodeUrl = new URL(`${IG_GRAPH_API_BASE}/${contentId}`);
    nodeUrl.searchParams.set("fields", "id,media_type,media_product_type");
    nodeUrl.searchParams.set("access_token", accessToken);
    const nodeResult = await safeGet(nodeUrl);
    const mediaType = nodeResult.ok ? ((nodeResult.body.media_type as string) ?? null) : null;
    const mediaProductType = nodeResult.ok ? ((nodeResult.body.media_product_type as string) ?? null) : null;

    // Reproduce the exact current combined request for this type first.
    const type = mediaProductType?.toUpperCase();
    const currentMetricList =
      type === "REELS"
        ? ["plays", "reach", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"]
        : type === "STORY"
          ? ["impressions", "reach", "exits", "replies", "taps_forward", "taps_back"]
          : ["impressions", "reach", "saved"];
    const combinedUrl = new URL(`${IG_GRAPH_API_BASE}/${contentId}/insights`);
    combinedUrl.searchParams.set("metric", currentMetricList.join(","));
    combinedUrl.searchParams.set("access_token", accessToken);
    const combined = await safeGet(combinedUrl);

    const perMetric: Array<{ metric: string; outcome: "supported" | "empty" | "rejected"; error: ReturnType<typeof safeError> }> = [];
    for (const metric of CANDIDATE_INSTAGRAM_METRICS) {
      const url = new URL(`${IG_GRAPH_API_BASE}/${contentId}/insights`);
      url.searchParams.set("metric", metric);
      url.searchParams.set("access_token", accessToken);
      const result = await safeGet(url);
      if (!result.ok) {
        perMetric.push({ metric, outcome: "rejected", error: safeError(result.error) });
        continue;
      }
      const data = (result.body.data as Array<{ values?: Array<{ value?: unknown }> }> | undefined) ?? [];
      const hasValue = data.some((entry) => entry.values?.[0]?.value !== undefined);
      perMetric.push({ metric, outcome: hasValue ? "supported" : "empty", error: null });
    }

    results.push({
      contentId,
      mediaType,
      mediaProductType,
      combinedRequestOutcome: combined.ok ? "ok" : "rejected",
      combinedRequestError: combined.ok ? null : safeError(combined.error),
      perMetric,
    });
  }

  return results;
}

// ---- Facebook personal-profile capability (Part 5) ----

async function testFacebookAccountPosts(userAccessToken: string) {
  const url = new URL(`${GRAPH_API_BASE}/me/posts`);
  url.searchParams.set("fields", "id,message,created_time,permalink_url");
  url.searchParams.set("limit", "5");
  url.searchParams.set("access_token", userAccessToken);
  const result = await safeGet(url);
  if (!result.ok) {
    return { outcome: "rejected" as const, error: safeError(result.error), postCount: 0, availableFields: [] as string[] };
  }
  const data = (result.body.data as Array<Record<string, unknown>> | undefined) ?? [];
  const availableFields = data.length > 0 ? Object.keys(data[0]!).filter((k) => k !== "id") : [];
  return { outcome: "ok" as const, error: null, postCount: data.length, availableFields };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const check = url.searchParams.get("check");
  if (check !== "facebookPageFields" && check !== "instagramMetrics" && check !== "facebookAccountPosts") {
    return NextResponse.json(
      { error: "check must be one of: facebookPageFields, instagramMetrics, facebookAccountPosts" },
      { status: 400 },
    );
  }

  const { connectionService } = await createServices();

  if (check === "facebookPageFields") {
    const pageConnection = await connectionService.getConnection(CONNECTION_IDS.facebookPage);
    const pageCredential = await connectionService.getDecryptedCredential(CONNECTION_IDS.facebookPage);
    if (!pageConnection?.externalAccountId || !pageCredential) {
      return NextResponse.json({ status: "error", stage: "connection" }, { status: 503 });
    }
    const results = await testFacebookPageFields(
      pageConnection.externalAccountId,
      pageCredential.accessToken as string,
    );
    return NextResponse.json({ status: "ok", pageId: pageConnection.externalAccountId, fields: results });
  }

  if (check === "instagramMetrics") {
    const igCredential = await connectionService.getDecryptedCredential(CONNECTION_IDS.instagram);
    if (!igCredential) {
      return NextResponse.json({ status: "error", stage: "connection" }, { status: 503 });
    }
    const results = await testInstagramMetrics(igCredential.accessToken as string);
    return NextResponse.json({ status: "ok", results });
  }

  const accountCredential = await connectionService.getDecryptedCredential(CONNECTION_IDS.facebookAccount);
  if (!accountCredential) {
    return NextResponse.json({ status: "error", stage: "connection" }, { status: 503 });
  }
  const result = await testFacebookAccountPosts(accountCredential.accessToken as string);
  return NextResponse.json({ status: "ok", mePosts: result });
}
