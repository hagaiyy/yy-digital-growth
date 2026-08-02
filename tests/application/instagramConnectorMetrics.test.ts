import { test } from "node:test";
import assert from "node:assert/strict";

import { InstagramConnector } from "@/application/connectors/InstagramConnector";

// Every real reel candidate metric (views, reach, saved, shares,
// total_interactions, ig_reels_avg_watch_time, ig_reels_video_view_total_time)
// succeeds — impressions/plays/follows/profile_activity are never even
// requested because the registry already knows they don't apply to reels.
function mockReelInsightsResponse() {
  return {
    data: [
      { name: "views", values: [{ value: 609 }] },
      { name: "reach", values: [{ value: 466 }] },
      { name: "saved", values: [{ value: 1 }] },
      { name: "shares", values: [{ value: 4 }] },
      { name: "total_interactions", values: [{ value: 31 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 10465 }] },
      { name: "ig_reels_video_view_total_time", values: [{ value: 5525570 }] },
      { name: "reels_skip_rate", values: [{ value: 61.7 }] },
    ],
  };
}

test("a reel where every genuinely-attempted metric succeeds is 'complete', not 'partial' because of permanently-excluded metrics", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify(mockReelInsightsResponse()), { status: 200 })) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const outcome = await connector.fetchContentMetrics(
      "fake-token",
      "17897479950464953",
      "reel",
      { likeCount: 21, commentsCount: 3, rawAccountType: "MEDIA_CREATOR" },
    );

    assert.equal(outcome.kind, "success");
    if (outcome.kind === "success") {
      assert.equal(outcome.dataCompleteness, "complete");
      // impressions/plays/follows/profile_activity are recorded as
      // known-excluded for provenance, but must never count against
      // completeness for a type they were never expected to apply to.
      const excludedNames = outcome.failedMetrics.map((f) => f.metric);
      assert.ok(excludedNames.includes("impressions"));
      assert.ok(excludedNames.includes("follows"));
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("a reel where a genuinely-attempted metric is missing from the response is 'partial'", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        // Combined request succeeds, but ig_reels_video_view_total_time
        // is genuinely absent from the response — a real, attempted
        // metric that did not come back, distinct from the
        // permanently-excluded ones (impressions/plays/follows/etc.).
        data: mockReelInsightsResponse().data.filter((entry) => entry.name !== "ig_reels_video_view_total_time"),
      }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const outcome = await connector.fetchContentMetrics(
      "fake-token",
      "17897479950464953",
      "reel",
      { likeCount: 21, commentsCount: 3, rawAccountType: "MEDIA_CREATOR" },
    );
    assert.equal(outcome.kind, "success");
    if (outcome.kind === "success") {
      assert.equal(outcome.dataCompleteness, "partial");
      assert.ok(outcome.failedMetrics.some((f) => f.metric === "totalWatchTimeMs"));
    }
  } finally {
    global.fetch = originalFetch;
  }
});

// Live-observed error payloads (2026-08-02 diagnostic against 4 real
// Reels, see scripts/diagnose-instagram-metrics.ts) — used verbatim so
// these tests prove the connector reacts correctly to what Meta
// actually returns, not to an invented shape.
const PLAYS_INVALID_METRIC_ERROR = {
  error: {
    message:
      "metric[0] must be one of the following values: impressions, shares, comments, likes, saved, replies, total_interactions, navigation, follows, profile_visits, profile_activity, reach, ig_reels_video_view_total_time, ig_reels_avg_watch_time, views, ...",
    type: "IGApiException",
    code: 100,
  },
};

const FACEBOOK_DISTRIBUTION_REQUIRED_ERROR = {
  error: {
    message: "Fatal",
    type: "OAuthException",
    code: -1,
    error_subcode: 2207086,
  },
};

function individualMetricUrl(url: string): string | null {
  const parsed = new URL(url);
  const metric = parsed.searchParams.get("metric");
  if (!metric || metric.includes(",")) return null; // combined request — force bisection
  return metric;
}

test("plays is classified 'deprecated' with a precise reason, never hidden as invalidForContentType", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const single = individualMetricUrl(url);
    if (single === null) {
      return new Response(JSON.stringify({ error: { message: "forced bisection", code: 1 } }), { status: 400 });
    }
    if (single === "plays") {
      return new Response(JSON.stringify(PLAYS_INVALID_METRIC_ERROR), { status: 400 });
    }
    if (single === "views") {
      return new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 609 }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const outcome = await connector.fetchContentMetrics(
      "fake-token",
      "17897479950464953",
      "reel",
      { likeCount: 21, commentsCount: 3, rawAccountType: "MEDIA_CREATOR" },
    );
    assert.equal(outcome.kind, "success");
    if (outcome.kind !== "success") return;
    // "plays" is deprecated in the registry, so it is never actually
    // requested at all — it comes back pre-classified via excludedMetrics.
    const playsRecord = outcome.metricRecords?.find((r) => r.internalMetric === "plays");
    assert.equal(playsRecord?.status, "deprecated");
    assert.notEqual(playsRecord?.status, "invalidForContentType");
    const viewsRecord = outcome.metricRecords?.find((r) => r.internalMetric === "views");
    assert.equal(viewsRecord?.value, 609);
  } finally {
    global.fetch = originalFetch;
  }
});

test("facebook_views and crossposted_views are classified contextually from the live 'no Facebook distribution' error, not generic unsupported", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const single = individualMetricUrl(url);
    if (single === null) {
      return new Response(JSON.stringify({ error: { message: "forced bisection", code: 1 } }), { status: 400 });
    }
    if (single === "facebook_views" || single === "crossposted_views") {
      return new Response(JSON.stringify(FACEBOOK_DISTRIBUTION_REQUIRED_ERROR), { status: 400 });
    }
    if (single === "views") {
      return new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 609 }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const outcome = await connector.fetchContentMetrics(
      "fake-token",
      "17897479950464953",
      "reel",
      { likeCount: 21, commentsCount: 3, rawAccountType: "MEDIA_CREATOR" },
    );
    assert.equal(outcome.kind, "success");
    if (outcome.kind !== "success") return;
    const fbViews = outcome.metricRecords?.find((r) => r.internalMetric === "facebookViews");
    const crossposted = outcome.metricRecords?.find((r) => r.internalMetric === "crosspostedViews");
    assert.equal(fbViews?.status, "noFacebookDistribution");
    assert.equal(fbViews?.safeReasonMessage, "Not available through current API");
    assert.equal(crossposted?.status, "notCrossposted");
    assert.equal(crossposted?.safeReasonMessage, "Not available through current API");
    assert.notEqual(fbViews?.status, "unsupported");
    assert.notEqual(crossposted?.status, "unsupported");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a genuinely different error on facebook_views (e.g. a real permission problem) is not masked as noFacebookDistribution", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const single = individualMetricUrl(url);
    if (single === null) {
      return new Response(JSON.stringify({ error: { message: "forced bisection", code: 1 } }), { status: 400 });
    }
    if (single === "facebook_views") {
      return new Response(JSON.stringify({ error: { message: "Missing permission", type: "OAuthException", code: 10 } }), {
        status: 400,
      });
    }
    if (single === "views") {
      return new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 609 }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const outcome = await connector.fetchContentMetrics(
      "fake-token",
      "17897479950464953",
      "reel",
      { likeCount: 21, commentsCount: 3, rawAccountType: "MEDIA_CREATOR" },
    );
    assert.equal(outcome.kind, "success");
    if (outcome.kind !== "success") return;
    const fbViews = outcome.metricRecords?.find((r) => r.internalMetric === "facebookViews");
    // code=10 is a real permission error, not the proven distribution
    // subcode — must fall through to the generic classification.
    assert.equal(fbViews?.status, "permissionRequired");
  } finally {
    global.fetch = originalFetch;
  }
});
