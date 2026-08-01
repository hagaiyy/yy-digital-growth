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
    // Object field lookup — only "shares" is still genuinely requested;
    // likes.summary/comments.summary are excluded at planning time
    // (confirmed permanently rejected, see metricCapabilityRegistry).
    const fields = url.searchParams.get("fields") ?? "";
    const body: Record<string, unknown> = {};
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
      assert.ok(excludedNames.includes("likes"), "confirmed-permission-gapped metrics are recorded for provenance");
      assert.ok(excludedNames.includes("comments"));
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("a rejected /insights metric never blocks another /insights metric or the shares object field", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/insights")) {
      const metricParam = url.searchParams.get("metric") ?? "";
      const metrics = metricParam.split(",");
      if (metrics.length > 1) {
        // Combined request rejected — forces per-metric bisection.
        return new Response(JSON.stringify({ error: { type: "OAuthException", code: 100 } }), { status: 400 });
      }
      if (metrics[0] === "post_media_view") {
        return new Response(JSON.stringify({ error: { type: "OAuthException", code: 100 } }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ data: metrics.map((name) => ({ name, values: [{ value: 3 }] })) }),
        { status: 200 },
      );
    }
    const fields = url.searchParams.get("fields") ?? "";
    const body: Record<string, unknown> = {};
    if (fields === "shares") body.shares = { count: 1 };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    const connector = new FacebookConnector();
    const outcome = await connector.fetchPagePostMetrics("fake-token", "fake-post-id", "imagePost", "photo");

    assert.equal(outcome.kind, "success");
    if (outcome.kind === "success") {
      assert.equal(outcome.metrics.shares, 1);
      assert.equal(outcome.metrics.clicks, 3);
      assert.equal(outcome.metrics.reactionsLikeTotal, 3);
      assert.ok(outcome.failedMetrics.some((f) => f.metric === "views" && f.reason === "metricUnsupported"));
      assert.equal(outcome.dataCompleteness, "partial");
    }
  } finally {
    global.fetch = originalFetch;
  }
});
