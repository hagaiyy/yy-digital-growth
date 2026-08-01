import { test } from "node:test";
import assert from "node:assert/strict";

// These tests exercise the one database-failure stage that is
// deterministic without a live MongoDB instance: "configuration"
// (MONGODB_URI/MONGODB_DATABASE unset). Connection/database/collection/
// query-stage failures require an actual unreachable or misbehaving
// MongoDB server and are covered structurally (see
// tests/infrastructure/mongodbDiagnostics.test.ts and
// tests/interfaces/databaseDiagnosticLogging.test.ts) rather than here —
// this file does not guess at what a real Railway/Atlas failure looks
// like, only proves the configuration-missing path end to end.

const mutableEnv = process.env as Record<string, string | undefined>;

async function withoutMongoConfig<T>(run: () => Promise<T>): Promise<T> {
  const previousUri = mutableEnv.MONGODB_URI;
  const previousDb = mutableEnv.MONGODB_DATABASE;
  delete mutableEnv.MONGODB_URI;
  delete mutableEnv.MONGODB_DATABASE;
  try {
    return await run();
  } finally {
    if (previousUri !== undefined) mutableEnv.MONGODB_URI = previousUri;
    if (previousDb !== undefined) mutableEnv.MONGODB_DATABASE = previousDb;
  }
}

function captureConsoleError(run: () => Promise<unknown>): Promise<{ result: unknown; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return run()
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.error = original;
    });
}

// Scenario: GET /api/connections' HTTP response must be byte-identical to
// before this change — only the server-side logging is new.
test("GET /api/connections still returns the existing setupRequired response when MongoDB is unconfigured", async () => {
  await withoutMongoConfig(async () => {
    const { GET } = await import("@/app/api/connections/route");
    const { result: response, lines } = await captureConsoleError(async () => GET());
    const typedResponse = response as Response;
    assert.equal(typedResponse.status, 500);
    const body = (await typedResponse.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "setupRequired");
    assert.equal(body.error.message, "The database is not configured.");

    // Two log lines are expected: our new structured diagnostic, and the
    // existing generic fallback inside toErrorResponse — neither may ever
    // contain MONGODB_URI's value (it's unset here, but the safe log line
    // must not echo env var content either way).
    assert.ok(lines.length >= 1);
    const structuredLine = lines.find((line) => line.startsWith("{"));
    assert.ok(structuredLine, "expected a structured JSON diagnostic line");
    const parsed = JSON.parse(structuredLine!) as Record<string, unknown>;
    assert.equal(parsed.route, "api/connections");
    assert.equal(parsed.stage, "configuration");
    assert.ok(!("message" in parsed));
  });
});

test("GET /api/health/database reports stage: configuration when MongoDB is unconfigured, and nothing else", async () => {
  await withoutMongoConfig(async () => {
    const { GET } = await import("@/app/api/health/database/route");
    const { result: response, lines } = await captureConsoleError(async () => GET());
    const typedResponse = response as Response;
    assert.equal(typedResponse.status, 503);
    const body = (await typedResponse.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["stage", "status"]);
    assert.equal(body.status, "error");
    assert.equal(body.stage, "configuration");

    const structuredLine = lines.find((line) => line.startsWith("{"));
    assert.ok(structuredLine, "expected a structured JSON diagnostic line");
    const parsed = JSON.parse(structuredLine!) as Record<string, unknown>;
    assert.equal(parsed.route, "api/health/database");
    assert.equal(parsed.stage, "configuration");
  });
});

test("the health/database route response never contains a document, connection string, or any field beyond status/stage", async () => {
  await withoutMongoConfig(async () => {
    const { GET } = await import("@/app/api/health/database/route");
    const response = await GET();
    const raw = await response.text();
    assert.ok(!raw.includes("mongodb"));
    assert.ok(!raw.includes("_id"));
    assert.equal(raw, JSON.stringify({ status: "error", stage: "configuration" }));
  });
});
