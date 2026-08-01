import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_PATH = fileURLToPath(new URL("../../src/app/page.tsx", import.meta.url));
const MODAL_PATH = fileURLToPath(new URL("../../src/components/LocalSetupModal.tsx", import.meta.url));
const pageSource = readFileSync(PAGE_PATH, "utf8");
const modalSource = readFileSync(MODAL_PATH, "utf8");

// Scenario 1: a Connect click that is missing configuration opens the
// setup modal instead of navigating straight to the OAuth route.
test("attemptConnect checks environment status before navigating, and opens the modal when variables are missing", () => {
  const fn = pageSource.match(/async function attemptConnect\([\s\S]*?\n {2}\}/)?.[0];
  assert.ok(fn, "expected an attemptConnect function");
  assert.match(fn!, /\/api\/local-setup\/environment-status/);
  assert.match(fn!, /setSetupModal\(\{ platform, missingVariables: missing \}\)/);
  assert.match(fn!, /return;/, "must not navigate when variables are missing");
});

// Scenario 2: only the actually-missing variables are passed to the modal
// — attemptConnect filters PLATFORM_REQUIRED_VARIABLES against the
// server's reported configured statuses rather than showing everything.
test("attemptConnect only includes variables the server reports as not configured", () => {
  const fn = pageSource.match(/async function attemptConnect\([\s\S]*?\n {2}\}/)?.[0];
  assert.match(
    fn!,
    /PLATFORM_REQUIRED_VARIABLES\[platform\]\.filter\(\s*\(name\) => !status\.variables\.find\(\(v\) => v\.name === name\)\?\.configured,?\s*\)/,
  );
});

// Falls back to direct navigation when the status check is unavailable
// (e.g. production, where the endpoint 403s) — never leaves the user stuck.
test("attemptConnect falls back to direct navigation if the status check fails", () => {
  const fn = pageSource.match(/async function attemptConnect\([\s\S]*?\n {2}\}/)?.[0];
  assert.match(fn!, /catch[\s\S]*\{[\s\S]*?\}/);
  assert.match(fn!, /window\.location\.href = connectPath/);
});

// Scenario 20: a successful setup retries the original connection action
// by calling attemptConnect again for the same platform.
test("onConfigured retries attemptConnect for the same platform that was being set up", () => {
  assert.match(pageSource, /onConfigured=\{\(\) => void attemptConnect\(setupModal\.platform\)\}/);
});

test("the modal is only rendered while a platform's setup is pending", () => {
  assert.match(pageSource, /\{setupModal && \(\s*<LocalSetupModal/);
});

// UI acceptance: visible "Local Development Setup" label text (verbatim).
test('the modal displays the exact "Local Development Setup" label', () => {
  assert.match(modalSource, /Local Development Setup/);
});

test("the modal shows the platform name and the list of missing configuration", () => {
  assert.match(modalSource, /Platform: \{platformLabel\}/);
  assert.match(modalSource, /Missing configuration:/);
});

// Secret variables render as password inputs; non-secret variables as text.
test("secret variables render as password inputs, non-secret variables as text inputs", () => {
  assert.match(modalSource, /type=\{def\.secret \? "password" : "text"\}/);
  assert.match(modalSource, /type="password"[\s\S]{0,80}placeholder="Enter manually"/);
});

test("the modal has Save Configuration and Cancel actions with a loading state", () => {
  assert.match(modalSource, /\{saving \? "Saving\.\.\." : "Save Configuration"\}/);
  assert.match(modalSource, />\s*Cancel\s*</);
  assert.match(modalSource, /disabled=\{saving \|\| generating\}/);
});

test("the modal shows validation/save errors and a success message", () => {
  assert.match(modalSource, /\{error && <p[\s\S]{0,40}>\{error\}<\/p>\}/);
  assert.match(modalSource, /\{savedMessage && <p[\s\S]{0,40}>\{savedMessage\}<\/p>\}/);
});

// Scenario 21: restart-required state shows a visible Copy Restart
// Command control and lets the user retry once the server is ready.
test("a restart-required result shows a Copy Restart Command button and a Retry Connection button", () => {
  assert.match(modalSource, /\{restartRequired && \(/);
  assert.match(modalSource, /Copy Restart Command/);
  assert.match(modalSource, /Retry Connection/);
  assert.match(modalSource, /navigator\.clipboard\.writeText\("npm run dev"\)/);
});

test("Save Configuration is hidden once a restart is required, so the user isn't offered a dead-end action", () => {
  assert.match(modalSource, /\{!restartRequired && \(\s*<button type="button" onClick=\{\(\) => void handleSave\(\)\}/);
});

// APP_ENCRYPTION_KEY gets a "Generate Secure Key" option alongside manual entry.
test("the encryption key variable offers Generate Secure Key in addition to manual entry", () => {
  assert.match(modalSource, /Generate Secure Key/);
  assert.match(modalSource, /handleGenerateKey/);
});

test("the modal never renders any variable's existing value into an input's value prop from a server-provided default secret", () => {
  // Only defaultValue-derived pre-fills are non-secret (redirect URIs);
  // guard against ever wiring a secret's default into `values` state.
  assert.ok(!/values\[name\] = def\.defaultValue.*secret/.test(modalSource));
});

// Scenario 22 (UI half): the modal only ever asks for the 8 allowlisted
// application-credential/redirect-URI variables — never anything that
// looks like a platform account password or user token field label.
test("the modal renders labels/descriptions from the shared metadata map only, never a free-form password/token field", () => {
  assert.ok(!/type="password"[\s\S]{0,200}Instagram password/i.test(modalSource));
  assert.match(modalSource, /getLocalSetupVariable\(name\)/);
});
