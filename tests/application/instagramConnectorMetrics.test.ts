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
