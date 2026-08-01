import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_SETUP_VARIABLES,
  LOCAL_SETUP_VARIABLE_NAMES,
  PLATFORM_REQUIRED_VARIABLES,
  getLocalSetupVariable,
  isKnownLocalSetupVariable,
  isPlaceholderValue,
} from "@/config/localSetupVariables";

test("isPlaceholderValue recognizes obvious test/example values", () => {
  for (const value of [
    "test-meta-app-id-123",
    "test-meta-app-secret-456",
    "test-pinterest-app-id",
    "test-pinterest-secret",
    "placeholder-value",
    "example-app-id",
    "your-app-id-here",
    "changeme-secret",
  ]) {
    assert.equal(isPlaceholderValue(value), true, `expected "${value}" to be flagged as a placeholder`);
  }
});

test("isPlaceholderValue does not flag real-looking credential values", () => {
  for (const value of ["a1b2c3d4e5f6g7", "1234567890123456", "configured-ig-app-id", undefined, ""]) {
    assert.equal(isPlaceholderValue(value), false, `expected "${value}" not to be flagged as a placeholder`);
  }
});

test("exactly the 10 specified variables are defined, no more, no less", () => {
  assert.deepEqual(
    [...LOCAL_SETUP_VARIABLE_NAMES].sort(),
    [
      "APP_ENCRYPTION_KEY",
      "INSTAGRAM_APP_ID",
      "INSTAGRAM_APP_SECRET",
      "INSTAGRAM_REDIRECT_URI",
      "META_APP_ID",
      "META_APP_SECRET",
      "META_REDIRECT_URI",
      "PINTEREST_APP_ID",
      "PINTEREST_APP_SECRET",
      "PINTEREST_REDIRECT_URI",
    ],
  );
});

test("secret variables are flagged secret: true and use the secret/encryptionKey format", () => {
  for (const name of ["META_APP_SECRET", "INSTAGRAM_APP_SECRET", "PINTEREST_APP_SECRET", "APP_ENCRYPTION_KEY"]) {
    const def = getLocalSetupVariable(name);
    assert.ok(def, `expected a definition for ${name}`);
    assert.equal(def!.secret, true, `${name} must be marked secret`);
  }
});

test("non-secret variables are flagged secret: false", () => {
  for (const name of [
    "META_APP_ID",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_REDIRECT_URI",
    "META_REDIRECT_URI",
    "PINTEREST_APP_ID",
    "PINTEREST_REDIRECT_URI",
  ]) {
    const def = getLocalSetupVariable(name);
    assert.ok(def, `expected a definition for ${name}`);
    assert.equal(def!.secret, false, `${name} must not be marked secret`);
  }
});

// Scenario 4: existing secret values are never pre-filled in the UI — no
// secret-formatted variable may carry a defaultValue.
test("no secret variable has a pre-filled defaultValue", () => {
  for (const def of LOCAL_SETUP_VARIABLES) {
    if (def.secret || def.format === "secret" || def.format === "encryptionKey") {
      assert.equal(def.defaultValue, undefined, `${def.name} must never have a pre-filled default`);
    }
  }
});

// Scenario 5: redirect URI defaults match the exact specified local
// callback URLs.
test("redirect URI variables are pre-filled with the exact expected localhost callback defaults", () => {
  assert.equal(
    getLocalSetupVariable("INSTAGRAM_REDIRECT_URI")?.defaultValue,
    "https://localhost:3000/api/connections/instagram/callback",
  );
  assert.equal(
    getLocalSetupVariable("META_REDIRECT_URI")?.defaultValue,
    "https://localhost:3000/api/connections/facebook/callback",
  );
  assert.equal(
    getLocalSetupVariable("PINTEREST_REDIRECT_URI")?.defaultValue,
    "https://localhost:3000/api/connections/pinterest/callback",
  );
});

test("only APP_ENCRYPTION_KEY may be auto-generated", () => {
  for (const def of LOCAL_SETUP_VARIABLES) {
    assert.equal(def.canGenerate, def.name === "APP_ENCRYPTION_KEY", `unexpected canGenerate for ${def.name}`);
  }
});

test("isKnownLocalSetupVariable accepts only the allowlisted names", () => {
  assert.equal(isKnownLocalSetupVariable("META_APP_ID"), true);
  assert.equal(isKnownLocalSetupVariable("MONGODB_URI"), false);
  assert.equal(isKnownLocalSetupVariable("INSTAGRAM_ACCESS_TOKEN"), false);
  assert.equal(isKnownLocalSetupVariable("__proto__"), false);
});

test("PLATFORM_REQUIRED_VARIABLES lists the correct variables per platform, including the shared encryption key", () => {
  assert.deepEqual(
    [...PLATFORM_REQUIRED_VARIABLES.instagram].sort(),
    ["APP_ENCRYPTION_KEY", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"],
  );
  assert.deepEqual(
    [...PLATFORM_REQUIRED_VARIABLES.facebook].sort(),
    ["APP_ENCRYPTION_KEY", "META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
  );
  assert.deepEqual(
    [...PLATFORM_REQUIRED_VARIABLES.pinterest].sort(),
    ["APP_ENCRYPTION_KEY", "PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"],
  );
});

// Scenario 22: the setup form must never ask for a platform password or a
// manually generated user access/account token — only application
// credentials and redirect URIs.
test("no variable name or label references a platform password or a user access/account token", () => {
  const forbiddenPattern = /password|access[_ ]?token|account[_ ]?token|user[_ ]?token/i;
  for (const def of LOCAL_SETUP_VARIABLES) {
    assert.ok(!forbiddenPattern.test(def.name), `variable name "${def.name}" must not reference a password/token`);
    assert.ok(!forbiddenPattern.test(def.label), `label for "${def.name}" must not reference a password/token`);
    assert.ok(
      !forbiddenPattern.test(def.description),
      `description for "${def.name}" must not reference a password/token`,
    );
  }
});
