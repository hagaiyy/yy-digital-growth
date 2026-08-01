import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { generateOAuthState, verifyOAuthState } from "@/interfaces/http/oauthState";

const SECRET = "test-oauth-secret";

test("generates a state token that validates for the same platform and secret", () => {
  const state = generateOAuthState("facebook-account", SECRET);
  assert.equal(verifyOAuthState(state, "facebook-account", SECRET), true);
});

test("rejects a state token for a different platform", () => {
  const state = generateOAuthState("facebook-account", SECRET);
  assert.equal(verifyOAuthState(state, "pinterest", SECRET), false);
});

test("rejects a state token signed with a different secret", () => {
  const state = generateOAuthState("pinterest", SECRET);
  assert.equal(verifyOAuthState(state, "pinterest", "a-different-secret"), false);
});

test("rejects a tampered state token", () => {
  const state = generateOAuthState("pinterest", SECRET);
  const tampered = `${state.slice(0, -2)}xx`;
  assert.equal(verifyOAuthState(tampered, "pinterest", SECRET), false);
});

test("rejects a missing state token", () => {
  assert.equal(verifyOAuthState(null, "pinterest", SECRET), false);
  assert.equal(verifyOAuthState(undefined, "pinterest", SECRET), false);
  assert.equal(verifyOAuthState("", "pinterest", SECRET), false);
});

test("rejects an expired state token", () => {
  const payload = {
    platform: "pinterest",
    nonce: "fixed-nonce",
    iat: Date.now() - 20 * 60 * 1000,
    exp: Date.now() - 10 * 60 * 1000,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  // Reconstruct the same signing scheme as generateOAuthState to prove
  // an otherwise-validly-signed but expired token is still rejected.
  const signature = createHmac("sha256", SECRET).update(payloadBase64).digest("base64url");
  const state = `${payloadBase64}.${signature}`;
  assert.equal(verifyOAuthState(state, "pinterest", SECRET), false);
});
