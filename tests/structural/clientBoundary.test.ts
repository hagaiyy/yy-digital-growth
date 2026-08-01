import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_PATH = fileURLToPath(new URL("../../src/app/page.tsx", import.meta.url));

const FORBIDDEN_SUBSTRINGS = [
  "application/connectors",
  "infrastructure/crypto",
  "APP_ENCRYPTION_KEY",
  "META_APP_SECRET",
  "INSTAGRAM_APP_SECRET",
  "PINTEREST_APP_SECRET",
  "accessToken",
  "refreshToken",
];

// Scenario 14: token exchange happens server-side. The only client
// component in this phase is the Main Dashboard page; it must reach
// connectors, credential decryption, and every secret exclusively
// through fetch() calls to API routes — never by importing that code or
// referencing raw secret env-var names directly.
test("the Main Dashboard client component never imports connector/crypto code or secret env vars", () => {
  const source = readFileSync(PAGE_PATH, "utf8");
  assert.ok(source.startsWith('"use client"'), "expected the dashboard to be a client component");
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!source.includes(forbidden), `page.tsx must not reference "${forbidden}"`);
  }
});

test("the Main Dashboard only talks to the server through /api/connections and /api/local-setup fetch calls", () => {
  const source = readFileSync(PAGE_PATH, "utf8");
  // `[^()]*?` (not `[^>]*`) so a generic type argument that itself
  // contains a nested `>` (e.g. `apiFetch<{ items: Array<X> }>(...)`)
  // is still matched in full rather than silently truncating — while
  // excluding `(`/`)` keeps the lazy match from ever crossing into a
  // different function call entirely (our generics are plain type
  // shapes and never contain parens).
  const fetchTargets = [...source.matchAll(/\bapiFetch(?:<[^()]*?>)?\((["'`])(.*?)\1/g)].map(
    (match) => match[2]!,
  );
  const hrefTargets = [...source.matchAll(/window\.location\.href = (["'`])(.*?)\1/g)].map(
    (match) => match[2]!,
  );
  const allTargets = [...fetchTargets, ...hrefTargets];
  assert.ok(allTargets.length > 0, "expected the dashboard to call at least one API endpoint");
  assert.ok(
    fetchTargets.includes("/api/local-setup/environment-status"),
    "expected this test's regex to actually see the environment-status call",
  );
  for (const target of allTargets) {
    assert.ok(
      target.startsWith("/api/connections") || target.startsWith("/api/local-setup"),
      `unexpected network target: ${target}`,
    );
  }
});
