import { test } from "node:test";
import assert from "node:assert/strict";

import { InstagramConnector } from "@/application/connectors/InstagramConnector";

test("a rejected combined account-insights group is bisected so one bad metric never takes down the whole group", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  const requestedMetricLists: string[][] = [];

  global.fetch = (async (input: RequestInfo | URL) => {
    callCount += 1;
    const url = new URL(String(input));
    const metricParam = url.searchParams.get("metric") ?? "";
    const metrics = metricParam.split(",");
    requestedMetricLists.push(metrics);

    if (callCount === 1) {
      // The combined day-period group call is rejected outright.
      return new Response(JSON.stringify({ error: { type: "IGApiException", code: 100 } }), { status: 400 });
    }
    // Every individual bisected call succeeds except accounts_engaged.
    if (metrics.includes("accounts_engaged")) {
      return new Response(JSON.stringify({ error: { type: "IGApiException", code: 100 } }), { status: 400 });
    }
    return new Response(
      JSON.stringify({ data: metrics.map((name) => ({ name, total_value: { value: 42 } })) }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const groups = await connector.fetchAccountInsights("fake-token", "fake-account-id", "MEDIA_CREATOR");

    const dayGroup = groups.find((g) => g.period === "day" && g.timeframe === undefined);
    assert.ok(dayGroup, "expected a day-period group in the result");

    // Bisection happened: more than one request was made for this group.
    assert.ok(callCount > 2, "the combined rejection must trigger per-metric bisection");

    const reach = dayGroup!.metrics.find((m) => m.providerMetric === "reach");
    const accountsEngaged = dayGroup!.metrics.find((m) => m.providerMetric === "accounts_engaged");
    assert.equal(reach?.status, "supported", "a metric unrelated to the failure must still succeed");
    assert.equal(accountsEngaged?.status, "invalidForContentType", "the genuinely rejected metric is reported honestly");
    assert.equal(dayGroup!.completeness, "partial");
  } finally {
    global.fetch = originalFetch;
  }
});
