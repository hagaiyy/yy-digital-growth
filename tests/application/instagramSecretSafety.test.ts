import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { extractMetaSafeError } from "@/application/connectors/types";
import { InstagramConnector } from "@/application/connectors/InstagramConnector";

const CONNECTOR_PATH = fileURLToPath(new URL("../../src/application/connectors/InstagramConnector.ts", import.meta.url));

function bodyWithSecrets(overrides: Record<string, unknown> = {}) {
  return {
    error: {
      type: "OAuthException",
      code: 190,
      error_subcode: 460,
      message: "Session has expired",
      fbtrace_id: "AxYzTraceId",
      access_token: "IGAATeakedSecretTokenValue",
    },
    // A realistic paging block, exactly like Meta's real list responses —
    // the "next" URL always carries the caller's own access_token.
    paging: {
      next: "https://graph.instagram.com/v25.0/123/stories?access_token=IGAASecretTokenInPagingUrl&after=abc",
    },
    ...overrides,
  };
}

test("extractMetaSafeError never returns anything beyond type/code/subcode, even when the body carries a token", async () => {
  const response = new Response(JSON.stringify(bodyWithSecrets()), { status: 400 });
  const safeError = await extractMetaSafeError(response);
  assert.deepEqual(safeError, { type: "OAuthException", code: 190, subcode: 460 });
  const serialized = JSON.stringify(safeError);
  assert.ok(!serialized.includes("access_token"));
  assert.ok(!serialized.includes("SecretToken"));
  assert.ok(!serialized.includes("fbtrace_id"));
});

test("fetchActiveStories never surfaces the response's paging block or any access_token, even though Meta's real payload includes one", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "18121753487497090",
            media_type: "IMAGE",
            media_product_type: "STORY",
            timestamp: "2026-08-03T18:53:21+0000",
          },
        ],
        paging: {
          next: "https://graph.instagram.com/v25.0/123/stories?access_token=IGAASecretTokenInPagingUrl&after=abc",
        },
      }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const stories = await connector.fetchActiveStories("fake-token-value", "17841400432393050");
    const serialized = JSON.stringify(stories);
    assert.ok(!serialized.includes("access_token"), "returned Stories must never carry the paging/access_token block");
    assert.ok(!serialized.includes("SecretTokenInPagingUrl"));
    assert.ok(!serialized.includes("paging"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchRecentContent never surfaces the response's paging block or any access_token", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "17897479950464953", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-06-10T12:17:22+0000" }],
        paging: { next: "https://graph.instagram.com/v25.0/123/media?access_token=IGAASecretTokenInPagingUrl2&after=abc" },
      }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const connector = new InstagramConnector();
    const items = await connector.fetchRecentContent("fake-token-value", "17841400432393050", 10);
    const serialized = JSON.stringify(items);
    assert.ok(!serialized.includes("access_token"));
    assert.ok(!serialized.includes("SecretTokenInPagingUrl2"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("a rejected active-Stories/recent-content request throws a fixed safe message, never the request URL or token", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ error: { code: 1 } }), { status: 400 })) as typeof fetch;
  try {
    const connector = new InstagramConnector();
    await assert.rejects(
      () => connector.fetchActiveStories("super-secret-token-xyz", "17841400432393050"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(!message.includes("super-secret-token-xyz"));
        assert.ok(!message.includes("access_token"));
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("InstagramConnector never sends an Authorization header and never logs to the console", () => {
  const source = readFileSync(CONNECTOR_PATH, "utf8");
  // Matches an actual HTTP Authorization header being set (e.g. inside a
  // headers object or via .set(...)) — not the unrelated
  // "buildAuthorizationUrl" OAuth method name/comments.
  assert.ok(
    !/["'`]Authorization["'`]\s*:/.test(source) && !/\.set\(\s*["'`]Authorization["'`]/.test(source),
    "this connector authenticates via access_token query param only, never a header",
  );
  assert.ok(!source.includes("console.log") && !source.includes("console.error") && !source.includes("console.warn"));
});
