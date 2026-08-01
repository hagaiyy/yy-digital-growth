import { test } from "node:test";
import assert from "node:assert/strict";

import { ConnectionService } from "@/application/services/ConnectionService";
import { InstagramConnector } from "@/application/connectors/InstagramConnector";
import { FacebookConnector } from "@/application/connectors/FacebookConnector";
import { PinterestConnector } from "@/application/connectors/PinterestConnector";
import {
  InMemoryPlatformConnectionRepository,
  InMemoryPlatformCredentialRepository,
} from "../fakes/InMemoryRepositories";

// Uses the REAL connectors (not fakes) so this proves the actual
// production URL-building code — no live network call is made since
// buildAuthorizationUrl() only constructs a URL string, but everything
// downstream of it (client id/secret/redirect URI substitution, scope
// string) is the exact code a real click in the browser executes.
function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  }
}

function buildRealService() {
  return new ConnectionService({
    connectionRepository: new InMemoryPlatformConnectionRepository(),
    credentialRepository: new InMemoryPlatformCredentialRepository(),
    instagramConnector: new InstagramConnector(),
    facebookConnector: new FacebookConnector(),
    pinterestConnector: new PinterestConnector(),
  });
}

// Instagram Connect navigates to a real OAuth start route, which
// redirects to a genuine instagram.com authorization URL via Instagram
// API with Instagram Login, using INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET
// — never META_APP_ID/META_APP_SECRET, never a dead route, a
// placeholder, or a check against an environment-supplied user access
// token.
test("startInstagramConnect returns a real instagram.com authorization URL requesting only the two required scopes", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      INSTAGRAM_APP_ID: "real-test-ig-app-id",
      INSTAGRAM_APP_SECRET: "real-test-ig-app-secret",
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl } = await service.startInstagramConnect();
      assert.ok(redirectUrl, "expected a redirectUrl");
      const url = new URL(redirectUrl!);
      assert.equal(url.hostname, "www.instagram.com");
      assert.equal(url.searchParams.get("client_id"), "real-test-ig-app-id");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "https://localhost:3000/api/connections/instagram/callback",
      );
      assert.ok(url.searchParams.get("state"), "expected a non-empty CSRF state value");
      assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_manage_insights");
      assert.ok(!url.searchParams.get("scope")?.includes("publish"), "must never request a publish permission");
    },
  );
});

test("startInstagramConnect is not eligible using only META_APP_ID/META_APP_SECRET — Instagram credentials are separate", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      META_APP_ID: "real-test-app-id",
      META_APP_SECRET: "real-test-app-secret",
      INSTAGRAM_APP_ID: undefined,
      INSTAGRAM_APP_SECRET: undefined,
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl, connection } = await service.startInstagramConnect();
      assert.equal(redirectUrl, undefined);
      assert.equal(connection.status, "setupRequired");
      assert.match(connection.safeErrorMessage!, /INSTAGRAM_APP_ID/);
      assert.match(connection.safeErrorMessage!, /INSTAGRAM_APP_SECRET/);
    },
  );
});

test("startInstagramConnect returns no redirectUrl when not configured, and never asks for a user token", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: undefined,
      INSTAGRAM_APP_ID: undefined,
      INSTAGRAM_APP_SECRET: undefined,
      INSTAGRAM_REDIRECT_URI: undefined,
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl, connection } = await service.startInstagramConnect();
      assert.equal(redirectUrl, undefined);
      assert.equal(connection.status, "setupRequired");
      assert.ok(!connection.safeErrorMessage?.includes("INSTAGRAM_ACCESS_TOKEN"));
      assert.ok(!connection.safeErrorMessage?.includes("INSTAGRAM_ACCOUNT_ID"));
    },
  );
});

test("handleInstagramCallback with an invalid state fails safely, never silently", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      INSTAGRAM_APP_ID: "real-test-ig-app-id",
      INSTAGRAM_APP_SECRET: "real-test-ig-app-secret",
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    async () => {
      const service = buildRealService();
      const { success, connection } = await service.handleInstagramCallback("some-code", "tampered-state");
      assert.equal(success, false);
      assert.equal(connection.status, "failed");
      assert.ok(connection.safeErrorMessage);
    },
  );
});

// Scenario 3: Facebook Account Connect navigates to a real OAuth start
// route, which redirects to a genuine facebook.com authorization URL —
// never a dead route, a placeholder, or a fake "connected" result.
test("startFacebookAccountConnect returns a real facebook.com authorization URL when configured", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      META_APP_ID: "real-test-app-id",
      META_APP_SECRET: "real-test-app-secret",
      META_REDIRECT_URI: "http://localhost:3000/api/connections/facebook/callback",
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl } = await service.startFacebookAccountConnect();
      assert.ok(redirectUrl, "expected a redirectUrl");
      const url = new URL(redirectUrl!);
      assert.equal(url.hostname, "www.facebook.com");
      assert.equal(url.searchParams.get("client_id"), "real-test-app-id");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "http://localhost:3000/api/connections/facebook/callback",
      );
      assert.ok(url.searchParams.get("state"), "expected a non-empty CSRF state value");
      assert.ok(!url.searchParams.get("scope")?.includes("publish"), "must never request a publish permission");
    },
  );
});

test("startFacebookAccountConnect returns no redirectUrl when not configured", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: undefined,
      META_APP_ID: undefined,
      META_APP_SECRET: undefined,
      META_REDIRECT_URI: undefined,
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl, connection } = await service.startFacebookAccountConnect();
      assert.equal(redirectUrl, undefined);
      assert.equal(connection.status, "setupRequired");
    },
  );
});

// Scenario 4: Pinterest Connect navigates to a real OAuth start route.
test("startPinterestConnect returns a real pinterest.com authorization URL when configured", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      PINTEREST_APP_ID: "real-test-pin-app-id",
      PINTEREST_APP_SECRET: "real-test-pin-secret",
      PINTEREST_REDIRECT_URI: "http://localhost:3000/api/connections/pinterest/callback",
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl } = await service.startPinterestConnect();
      assert.ok(redirectUrl, "expected a redirectUrl");
      const url = new URL(redirectUrl!);
      assert.equal(url.hostname, "www.pinterest.com");
      assert.equal(url.searchParams.get("client_id"), "real-test-pin-app-id");
      assert.ok(url.searchParams.get("state"), "expected a non-empty CSRF state value");
    },
  );
});

test("startPinterestConnect returns no redirectUrl when not configured", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: undefined,
      PINTEREST_APP_ID: undefined,
      PINTEREST_APP_SECRET: undefined,
      PINTEREST_REDIRECT_URI: undefined,
    },
    async () => {
      const service = buildRealService();
      const { redirectUrl, connection } = await service.startPinterestConnect();
      assert.equal(redirectUrl, undefined);
      assert.equal(connection.status, "setupRequired");
    },
  );
});

// Scenario 7: callback failure (invalid/missing state) must not
// silently succeed or throw unhandled — it produces a "failed" status
// with a safe message.
test("handleFacebookAccountCallback with an invalid state fails safely, never silently", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      META_APP_ID: "real-test-app-id",
      META_APP_SECRET: "real-test-app-secret",
      META_REDIRECT_URI: "http://localhost:3000/api/connections/facebook/callback",
    },
    async () => {
      const service = buildRealService();
      const { success, connection } = await service.handleFacebookAccountCallback("some-code", "tampered-state");
      assert.equal(success, false);
      assert.equal(connection.status, "failed");
      assert.ok(connection.safeErrorMessage);
    },
  );
});

test("handlePinterestCallback with an invalid state fails safely, never silently", async () => {
  await withEnv(
    {
      APP_ENCRYPTION_KEY: "real-redirect-test-key",
      PINTEREST_APP_ID: "real-test-pin-app-id",
      PINTEREST_APP_SECRET: "real-test-pin-secret",
      PINTEREST_REDIRECT_URI: "http://localhost:3000/api/connections/pinterest/callback",
    },
    async () => {
      const service = buildRealService();
      const { success, connection } = await service.handlePinterestCallback("some-code", "tampered-state");
      assert.equal(success, false);
      assert.equal(connection.status, "failed");
      assert.ok(connection.safeErrorMessage);
    },
  );
});
