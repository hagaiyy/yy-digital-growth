import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This route calls createServices() (a real MongoDB connection) as soon
// as configuration is present, so only the deterministic, DB-free
// "configuration missing" path is exercised at runtime here — matching
// the established pattern for routes that depend on live external
// services (see tests/interfaces/localSetupRoutes.test.ts and
// tests/interfaces/databaseDiagnosticRoutes.test.ts). The success-path
// safety guarantees (never returning a token/secret) are verified
// structurally below instead.

const ROUTE_PATH = fileURLToPath(
  new URL("../../src/app/api/health/facebook-permissions/route.ts", import.meta.url),
);
const routeSource = readFileSync(ROUTE_PATH, "utf8");

const mutableEnv = process.env as Record<string, string | undefined>;

async function withoutFacebookConfig<T>(run: () => Promise<T>): Promise<T> {
  const previousAppId = mutableEnv.META_APP_ID;
  const previousAppSecret = mutableEnv.META_APP_SECRET;
  delete mutableEnv.META_APP_ID;
  delete mutableEnv.META_APP_SECRET;
  try {
    return await run();
  } finally {
    if (previousAppId !== undefined) mutableEnv.META_APP_ID = previousAppId;
    if (previousAppSecret !== undefined) mutableEnv.META_APP_SECRET = previousAppSecret;
  }
}

test("GET /api/health/facebook-permissions reports stage: configuration when META_APP_ID/META_APP_SECRET are unset, without touching MongoDB", async () => {
  await withoutFacebookConfig(async () => {
    const { GET } = await import("@/app/api/health/facebook-permissions/route");
    const response = await GET();
    assert.equal(response.status, 503);
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["stage", "status"]);
    assert.equal(body.status, "error");
    assert.equal(body.stage, "configuration");
  });
});

// Extracts the *final* NextResponse.json({ ... multi-line success-path
// call — found by its distinctive opening (the object literal starts on
// its own line, unlike the single-line errorResponse() helper's call) —
// through to end of file. Nothing meaningful follows this call, so
// slicing from its start to EOF is unambiguous.
function successPathJsonCallBody(): string {
  const start = routeSource.lastIndexOf("return NextResponse.json({\n");
  assert.ok(start !== -1, "expected to find the success-path NextResponse.json(...) call");
  return routeSource.slice(start);
}

test("the route never returns a raw token, secret, account name, or provider response body", () => {
  // The only values ever passed into NextResponse.json(...) in the
  // success path must come from this fixed, safe field list — never a
  // token/credential variable directly.
  const forbiddenIdentifiers = [
    "userAccessToken",
    "pageAccessToken",
    "appSecret",
    "userCredential",
    "pageCredential",
  ];
  const jsonCallBody = successPathJsonCallBody();
  for (const identifier of forbiddenIdentifiers) {
    assert.ok(
      !jsonCallBody.includes(identifier),
      `the JSON response body must never reference "${identifier}"`,
    );
  }
});

test("the route only ever fetches Meta's debug_token, permissions, and posts endpoints — no other Graph API surface", () => {
  for (const expectedPath of ["${GRAPH_API_BASE}/debug_token", "${GRAPH_API_BASE}/me/permissions", "${GRAPH_API_BASE}/${pageId}/posts"]) {
    assert.ok(routeSource.includes(expectedPath), `expected a call to ${expectedPath}`);
  }
  // No other graph.facebook.com edge (e.g. /insights, /me/accounts,
  // publishing endpoints) is referenced anywhere in this file.
  const templateLiteralUrls = [...routeSource.matchAll(/`\$\{GRAPH_API_BASE\}\/([^`]*)`/g)].map((m) => m[1]);
  assert.deepEqual(templateLiteralUrls.sort(), ["debug_token", "me/permissions", "${pageId}/posts"].sort());
});

test("the minimal posts check requests only id and created_time — never engagement, insights, or reactions fields", () => {
  const fieldsMatch = routeSource.match(/set\("fields",\s*"([^"]+)"\)/);
  assert.ok(fieldsMatch, "expected a fields= query param in the posts check");
  assert.equal(fieldsMatch![1], "id,created_time");
});

test("declined and granted permissions are read via the official /me/permissions endpoint, not guessed", () => {
  assert.match(routeSource, /me\/permissions/);
  assert.match(routeSource, /status === "granted"/);
  assert.match(routeSource, /status === "declined"/);
});

test("app secret is only ever used to build the debug_token access_token parameter, never returned", () => {
  assert.match(routeSource, /appSecret/, "expected appSecret to be used at all (to call debug_token)");
  assert.ok(
    !successPathJsonCallBody().includes("appSecret"),
    "the JSON response body must never reference appSecret",
  );
});
