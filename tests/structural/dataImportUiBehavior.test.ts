import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PANEL_PATH = fileURLToPath(new URL("../../src/components/DataImportPanel.tsx", import.meta.url));

// Scenario 20: after import completion, the interface re-fetches the
// imported-content list from MongoDB rather than rendering the platform
// response directly. Verified structurally: the import action's
// completion handling must call the same loader used for the initial
// page load, unconditionally (in a finally block), not only on success.
test("the Data Import panel re-fetches persisted content after every import attempt", () => {
  const source = readFileSync(PANEL_PATH, "utf8");

  const startImportMatch = source.match(/async function startImport\(\)[\s\S]*?\n {2}\}/);
  assert.ok(startImportMatch, "expected a startImport function");
  const body = startImportMatch![0];

  assert.ok(/finally\s*{[\s\S]*await loadItems\(\)/.test(body), "must re-fetch items unconditionally after import");
  assert.ok(/finally\s*{[\s\S]*await loadLatestRun\(\)/.test(body), "must re-fetch the run summary unconditionally");
});

test("the Data Import panel never renders a platform response directly, only fetched persisted state", () => {
  const source = readFileSync(PANEL_PATH, "utf8");
  // setItems must only ever be called with data returned from
  // /api/imported-content (via loadItems), never with the importRun
  // response body itself.
  const setItemsCalls = [...source.matchAll(/setItems\(([^)]*)\)/g)].map((m) => m[1]);
  for (const arg of setItemsCalls) {
    assert.ok(arg!.includes("body.items"), `setItems must be called with fetched items, got: ${arg}`);
  }
});
