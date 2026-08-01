import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// These tests only exercise the production-blocked path of each route
// handler directly — that path returns before ever constructing a
// LocalSetupService, so it never touches the real .env.local file.
// Non-production behavior is covered by LocalSetupService's own tests
// (tests/application/localSetupService.test.ts), which use a temporary
// file instead of the real one.

const mutableEnv = process.env as Record<string, string | undefined>;

async function withProductionEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    return await run();
  } finally {
    mutableEnv.NODE_ENV = previous;
  }
}

test("GET /api/local-setup/environment-status is blocked in production", async () => {
  await withProductionEnv(async () => {
    const { GET } = await import("@/app/api/local-setup/environment-status/route");
    const response = await GET();
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "productionBlocked");
    assert.match(body.error.message, /development/i);
  });
});

test("POST /api/local-setup/environment is blocked in production", async () => {
  await withProductionEnv(async () => {
    const { POST } = await import("@/app/api/local-setup/environment/route");
    const request = new Request("http://localhost/api/local-setup/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: { META_APP_ID: "should-never-be-written" } }),
    });
    const response = await POST(request);
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "productionBlocked");
  });
});

test("POST /api/local-setup/generate-encryption-key is blocked in production", async () => {
  await withProductionEnv(async () => {
    const { POST } = await import("@/app/api/local-setup/generate-encryption-key/route");
    const response = await POST();
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "productionBlocked");
  });
});

function routeSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/app/api/local-setup/${relativePath}`, import.meta.url)), "utf8");
}

test("the environment save route never echoes the request body into an error response", () => {
  const source = routeSource("environment/route.ts");
  assert.ok(!/message:\s*`[^`]*\$\{.*body/i.test(source), "must not interpolate the raw body into a message");
  assert.match(source, /Never echo the unparseable body back in the error/i);
});

test("neither local-setup route logs submitted or generated values", () => {
  for (const relativePath of ["environment/route.ts", "generate-encryption-key/route.ts", "environment-status/route.ts"]) {
    const source = routeSource(relativePath);
    const consoleCalls = [...source.matchAll(/console\.(log|error|warn|info|debug)\(([^)]*)\)/g)];
    for (const call of consoleCalls) {
      const args = call[2] ?? "";
      assert.ok(
        !/values|result|key|secret|body/i.test(args) || /unexpected error/i.test(args),
        `unexpected logging of potentially sensitive data in ${relativePath}: console.${call[1]}(${args})`,
      );
    }
  }
});

test("the generate-encryption-key route's response can only ever carry savedVariableNames/restartRequired, never the key", () => {
  const source = routeSource("generate-encryption-key/route.ts");
  assert.match(source, /NextResponse\.json\(result\)/, "must forward the service result as-is, never spread with extra fields");
  assert.ok(!/result\.key|generatedKey|\bkey\b\s*:/.test(source), "must never construct a response field carrying the key");
});
