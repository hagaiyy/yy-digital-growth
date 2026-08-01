import { test } from "node:test";
import assert from "node:assert/strict";

import { FacebookConnector } from "@/application/connectors/FacebookConnector";

test("a post where every genuinely-attempted metric succeeds is 'complete', not held back by permanently-excluded metrics", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/insights")) {
      // post_impressions/post_impressions_unique are excluded (deprecated)
      // at planning time and must never even reach this mock.
      const metricParam = url.searchParams.get("metric") ?? "";
      const metrics = metricParam.split(",");
      return new Response(
        JSON.stringify({ data: metrics.map((name) => ({ name, values: [{ value: 10 }] })) }),
        { status: 200 },
      );
    }
    // Object field lookup (likes.summary/comments.summary/shares).
    const fields = url.searchParams.get("fields") ?? "";
    const body: Record<string, unknown> = {};
    if (fields.includes("likes")) body.likes = { summary: { total_count: 5 } };
    if (fields.includes("comments")) body.comments = { summary: { total_count: 2 } };
    if (fields === "shares") body.shares = { count: 1 };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new FacebookConnector();
    const outcome = await connector.fetchPagePostMetrics("fake-token", "fake-post-id", "imagePost", "photo");

    assert.equal(outcome.kind, "success");
    if (outcome.kind === "success") {
      assert.equal(outcome.dataCompleteness, "complete");
      const excludedNames = outcome.failedMetrics.map((f) => f.metric);
      assert.ok(excludedNames.includes("impressions"), "deprecated metrics are recorded for provenance");
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("a rejected object-field engagement counter never blocks another engagement counter or the insights metrics", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/insights")) {
      const metricParam = url.searchParams.get("metric") ?? "";
      const metrics = metricParam.split(",");
      return new Response(
        JSON.stringify({ data: metrics.map((name) => ({ name, values: [{ value: 3 }] })) }),
        { status: 200 },
      );
    }
    const fields = url.searchParams.get("fields") ?? "";
    if (fields.includes("likes")) {
      return new Response(JSON.stringify({ error: { type: "OAuthException", code: 10 } }), { status: 400 });
    }
    const body: Record<string, unknown> = {};
    if (fields.includes("comments")) body.comments = { summary: { total_count: 2 } };
    if (fields === "shares") body.shares = { count: 1 };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new FacebookConnector();
    const outcome = await connector.fetchPagePostMetrics("fake-token", "fake-post-id", "imagePost", "photo");

    assert.equal(outcome.kind, "success");
    if (outcome.kind === "success") {
      assert.equal(outcome.metrics.comments, 2);
      assert.equal(outcome.metrics.shares, 1);
      assert.ok(outcome.successfulMetrics.includes("clicks") || outcome.metrics.clicks !== undefined);
      assert.ok(outcome.failedMetrics.some((f) => f.metric === "likes" && f.reason === "permissionMissing"));
      assert.equal(outcome.dataCompleteness, "partial");
    }
  } finally {
    global.fetch = originalFetch;
  }
});
