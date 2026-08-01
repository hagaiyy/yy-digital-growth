import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_PATH = fileURLToPath(new URL("../../src/app/page.tsx", import.meta.url));
const source = readFileSync(PAGE_PATH, "utf8");

function jsxBlockFor(title: string): string {
  const start = source.indexOf(`title="${title}"`);
  assert.ok(start !== -1, `expected a ConnectionCard with title="${title}"`);
  const end = source.indexOf("/>", start);
  return source.slice(start, end);
}

// Scenario 2/3: Instagram Connect goes through attemptConnect(), which
// either navigates to the real interactive OAuth start route or opens
// the local-setup modal first — never merely checking an env-supplied
// token, and never a dead route.
test("Instagram Connect goes through attemptConnect, which targets the real Instagram OAuth connect route", () => {
  const block = jsxBlockFor("Instagram");
  assert.match(block, /onConnect=\{\(\) => void attemptConnect\("instagram"\)\}/);
  assert.match(source, /instagram: "\/api\/connections\/instagram\/connect"/);
});

test("Instagram Verify uses the generic re-verify endpoint, not a token-check endpoint", () => {
  const block = jsxBlockFor("Instagram");
  assert.match(block, /onVerify=\{[\s\S]*?\/api\/connections\/\$\{CONNECTION_IDS\.instagram\}\/verify/);
});

// Scenario 8: Facebook Account Connect starts the OAuth route (via the
// same attemptConnect pre-check as Instagram/Pinterest).
test("Facebook Account Connect goes through attemptConnect, which targets the existing Facebook OAuth connect route", () => {
  const block = jsxBlockFor("Facebook Account");
  assert.match(block, /onConnect=\{\(\) => void attemptConnect\("facebook"\)\}/);
  assert.match(source, /facebook: "\/api\/connections\/facebook\/connect"/);
});

// Scenario 11: Pinterest Connect starts the OAuth route (via the same
// attemptConnect pre-check).
test("Pinterest Connect goes through attemptConnect, which targets the existing Pinterest OAuth connect route", () => {
  const block = jsxBlockFor("Pinterest");
  assert.match(block, /onConnect=\{\(\) => void attemptConnect\("pinterest"\)\}/);
  assert.match(source, /pinterest: "\/api\/connections\/pinterest\/connect"/);
});

// Scenario 9: Facebook Page is disabled until Facebook Account is connected.
test("Facebook Page's Connect is gated behind Facebook Account being connected", () => {
  const block = jsxBlockFor("Facebook Page");
  assert.match(block, /onConnect=\{facebookAccount\?\.status === "connected" \? .*loadFacebookPages/);
  assert.match(
    block,
    /connectDisabledReason=\{[\s\S]*?facebookAccount\?\.status !== "connected"[\s\S]*?"Connect Facebook Account First"/,
  );
});

// Scenario 10: Facebook Page selection requires explicit user choice —
// the select's onChange only updates local state; only the separate
// "Save Page" button click actually persists a selection.
test("Facebook Page selection is only persisted by an explicit Save Page click, not on select", () => {
  assert.match(source, /<select value=\{selectedPageId\} onChange=\{\(event\) => setSelectedPageId/);
  const saveButtonBlock = source.slice(
    source.indexOf("Save Page") - 700,
    source.indexOf("Save Page") + 20,
  );
  assert.match(saveButtonBlock, /\/api\/connections\/facebook\/pages\/select/);
  assert.match(saveButtonBlock, /onClick=\{/, "selecting a Page must require an explicit click, not onChange");
});

test("listFacebookPages is fetched from the existing managed-Pages route", () => {
  assert.match(source, /\/api\/connections\/facebook\/pages"/);
});

// Scenario 13: a successful action re-fetches persisted connection state.
test("runAction always re-fetches connection state via load(), even on failure", () => {
  const runActionMatch = source.match(/async function runAction\([\s\S]*?\n {2}\}/);
  assert.ok(runActionMatch, "expected a runAction function");
  const body = runActionMatch![0];
  assert.match(body, /finally\s*{[\s\S]*await load\(\)/, "must re-fetch after every action attempt");
});

// Scenario 14: one platform failure does not affect other cards — errors
// and success feedback are keyed per connectionId, never shared/global.
test("action errors and success feedback are isolated per connectionId", () => {
  assert.match(source, /setActionErrors\(\(prev\) => \(\{ \.\.\.prev, \[connectionId\]:/);
  assert.match(source, /setActionSuccess\(\(prev\) => \(\{ \.\.\.prev, \[connectionId\]:/);
});

// Scenario 12: a failed action shows a safe error (the persisted
// safeErrorMessage or the caught action error), never a raw exception.
test("a failed action's safe error message is rendered on its own card", () => {
  assert.match(
    source,
    /\(connection\?\.safeErrorMessage \|\| errorMessage\) &&[\s\S]{0,120}<p[\s\S]{0,120}resolveDisplayedErrorMessage\(errorMessage, connection\?\.safeErrorMessage\)/,
  );
});

test("every card reads its own error/success state by its own connectionId", () => {
  for (const title of ["Instagram", "Facebook Account", "Facebook Page", "Pinterest"]) {
    const block = jsxBlockFor(title);
    assert.match(block, /errorMessage=\{actionErrors\[CONNECTION_IDS\./);
    assert.match(block, /successMessage=\{actionSuccess\[CONNECTION_IDS\./);
  }
});
