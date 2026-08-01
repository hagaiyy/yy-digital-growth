import { test } from "node:test";
import assert from "node:assert/strict";

import { InstagramConnector } from "@/application/connectors/InstagramConnector";
import { FacebookConnector } from "@/application/connectors/FacebookConnector";
import { PinterestConnector } from "@/application/connectors/PinterestConnector";
import { ConnectorError } from "@/application/connectors/types";

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

// Scenario 12 (connector level): Instagram names its specific missing
// application variables — never a user-supplied access token, since
// there is no such thing in this connector anymore.
test("InstagramConnector reports exactly which of its three application env vars are missing", () => {
  withEnv(
    { INSTAGRAM_APP_ID: undefined, INSTAGRAM_APP_SECRET: "secret", INSTAGRAM_REDIRECT_URI: undefined },
    () => {
      const connector = new InstagramConnector();
      assert.deepEqual(connector.getMissingConfigVars(), ["INSTAGRAM_APP_ID", "INSTAGRAM_REDIRECT_URI"]);
      assert.equal(connector.isConfigured(), false);
    },
  );
});

test("InstagramConnector.buildAuthorizationUrl throws setupRequired naming the missing vars, never a token, never META_*", () => {
  withEnv(
    { INSTAGRAM_APP_ID: undefined, INSTAGRAM_APP_SECRET: undefined, INSTAGRAM_REDIRECT_URI: undefined },
    () => {
      const connector = new InstagramConnector();
      assert.throws(
        () => connector.buildAuthorizationUrl("state"),
        (error: unknown) => {
          assert.ok(error instanceof ConnectorError);
          assert.equal(error.code, "setupRequired");
          assert.match(error.safeMessage, /INSTAGRAM_APP_ID/);
          assert.match(error.safeMessage, /INSTAGRAM_APP_SECRET/);
          assert.match(error.safeMessage, /INSTAGRAM_REDIRECT_URI/);
          assert.ok(!error.safeMessage.includes("INSTAGRAM_ACCESS_TOKEN"));
          assert.ok(!error.safeMessage.includes("INSTAGRAM_ACCOUNT_ID"));
          assert.ok(!error.safeMessage.includes("META_APP_ID"));
          assert.ok(!error.safeMessage.includes("META_APP_SECRET"));
          return true;
        },
      );
    },
  );
});

test("InstagramConnector.buildAuthorizationUrl produces a real Instagram-Login authorization URL requesting only the two required scopes", () => {
  withEnv(
    {
      INSTAGRAM_APP_ID: "configured-ig-app-id",
      INSTAGRAM_APP_SECRET: "configured-ig-app-secret",
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    () => {
      const connector = new InstagramConnector();
      assert.equal(connector.isConfigured(), true);
      const authUrl = connector.buildAuthorizationUrl("some-state");
      const url = new URL(authUrl);
      assert.equal(url.hostname, "www.instagram.com");
      assert.equal(url.searchParams.get("client_id"), "configured-ig-app-id");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "https://localhost:3000/api/connections/instagram/callback",
      );
      const scope = url.searchParams.get("scope") ?? "";
      assert.equal(scope, "instagram_business_basic,instagram_business_manage_insights");
      const requestedScopes = scope.split(",");
      for (const forbidden of ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"]) {
        assert.ok(!requestedScopes.includes(forbidden), `must not request the old scope "${forbidden}"`);
      }
      assert.ok(!scope.includes("publish"));
    },
  );
});

test("FacebookConnector reports exactly which of its three env vars are missing", () => {
  withEnv(
    { META_APP_ID: undefined, META_APP_SECRET: "secret", META_REDIRECT_URI: undefined },
    () => {
      const connector = new FacebookConnector();
      assert.deepEqual(connector.getMissingConfigVars(), ["META_APP_ID", "META_REDIRECT_URI"]);
      assert.equal(connector.isConfigured(), false);
    },
  );
});

test("FacebookConnector.buildAuthorizationUrl throws setupRequired naming the missing vars", () => {
  withEnv({ META_APP_ID: undefined, META_APP_SECRET: undefined, META_REDIRECT_URI: undefined }, () => {
    const connector = new FacebookConnector();
    assert.throws(
      () => connector.buildAuthorizationUrl("state"),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorError);
        assert.equal(error.code, "setupRequired");
        assert.match(error.safeMessage, /META_APP_ID/);
        assert.match(error.safeMessage, /META_APP_SECRET/);
        assert.match(error.safeMessage, /META_REDIRECT_URI/);
        return true;
      },
    );
  });
});

test("FacebookConnector.buildAuthorizationUrl produces a real facebook.com authorization URL requesting exactly the five required scopes, including read_insights and pages_read_user_content", () => {
  withEnv(
    {
      META_APP_ID: "configured-fb-app-id",
      META_APP_SECRET: "configured-fb-app-secret",
      META_REDIRECT_URI: "https://localhost:3000/api/connections/facebook/callback",
    },
    () => {
      const connector = new FacebookConnector();
      assert.equal(connector.isConfigured(), true);
      const authUrl = connector.buildAuthorizationUrl("some-state");
      const url = new URL(authUrl);
      assert.equal(url.hostname, "www.facebook.com");
      assert.equal(url.searchParams.get("client_id"), "configured-fb-app-id");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "https://localhost:3000/api/connections/facebook/callback",
      );
      const scope = url.searchParams.get("scope") ?? "";
      assert.equal(
        scope,
        "public_profile,pages_show_list,pages_read_engagement,pages_read_user_content,read_insights",
      );
      const requestedScopes = scope.split(",");
      assert.ok(
        requestedScopes.includes("read_insights"),
        "read_insights is now Ready for testing in the Meta app and must be requested",
      );
      assert.ok(
        requestedScopes.includes("pages_read_user_content"),
        "pages_read_user_content is now Ready for testing in the Meta app and must be requested",
      );
      for (const forbidden of [
        "pages_manage_posts",
        "pages_manage_engagement",
        "pages_manage_metadata",
        "user_posts",
        "business_management",
      ]) {
        assert.ok(!requestedScopes.includes(forbidden), `must never request ${forbidden}`);
      }
      assert.ok(!scope.includes("publish"));
      assert.ok(!scope.includes("ads"));
    },
  );
});

test("PinterestConnector reports exactly which of its three env vars are missing", () => {
  withEnv(
    { PINTEREST_APP_ID: "id", PINTEREST_APP_SECRET: undefined, PINTEREST_REDIRECT_URI: undefined },
    () => {
      const connector = new PinterestConnector();
      assert.deepEqual(connector.getMissingConfigVars(), ["PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"]);
      assert.equal(connector.isConfigured(), false);
    },
  );
});

test("PinterestConnector.buildAuthorizationUrl throws setupRequired naming the missing vars", () => {
  withEnv(
    { PINTEREST_APP_ID: undefined, PINTEREST_APP_SECRET: undefined, PINTEREST_REDIRECT_URI: undefined },
    () => {
      const connector = new PinterestConnector();
      assert.throws(
        () => connector.buildAuthorizationUrl("state"),
        (error: unknown) => {
          assert.ok(error instanceof ConnectorError);
          assert.equal(error.code, "setupRequired");
          assert.match(error.safeMessage, /PINTEREST_APP_ID/);
          assert.match(error.safeMessage, /PINTEREST_APP_SECRET/);
          assert.match(error.safeMessage, /PINTEREST_REDIRECT_URI/);
          return true;
        },
      );
    },
  );
});

// Placeholder values (e.g. left over from testing the local setup flow)
// must never be accepted as valid application configuration — otherwise
// the app would drive the user into a live OAuth redirect guaranteed to
// fail instead of showing the setup modal again.
test("InstagramConnector treats a placeholder INSTAGRAM_APP_ID as not configured", () => {
  withEnv(
    {
      INSTAGRAM_APP_ID: "test-instagram-app-id-123",
      INSTAGRAM_APP_SECRET: "real-secret-value",
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    () => {
      const connector = new InstagramConnector();
      assert.equal(connector.isConfigured(), false);
      assert.ok(connector.getMissingConfigVars().includes("INSTAGRAM_APP_ID"));
    },
  );
});

test("FacebookConnector treats a placeholder META_APP_SECRET as not configured", () => {
  withEnv(
    {
      META_APP_ID: "real-app-id",
      META_APP_SECRET: "test-meta-app-secret-456",
      META_REDIRECT_URI: "http://localhost:3000/api/connections/facebook/callback",
    },
    () => {
      const connector = new FacebookConnector();
      assert.equal(connector.isConfigured(), false);
      assert.ok(connector.getMissingConfigVars().includes("META_APP_SECRET"));
    },
  );
});

test("PinterestConnector treats a placeholder PINTEREST_APP_ID as not configured", () => {
  withEnv(
    {
      PINTEREST_APP_ID: "test-pinterest-app-id",
      PINTEREST_APP_SECRET: "real-secret-value",
      PINTEREST_REDIRECT_URI: "http://localhost:3000/api/connections/pinterest/callback",
    },
    () => {
      const connector = new PinterestConnector();
      assert.equal(connector.isConfigured(), false);
      assert.ok(connector.getMissingConfigVars().includes("PINTEREST_APP_ID"));
    },
  );
});

test("a fully configured Instagram connector reports no missing vars", () => {
  withEnv(
    {
      INSTAGRAM_APP_ID: "app-id",
      INSTAGRAM_APP_SECRET: "app-secret",
      INSTAGRAM_REDIRECT_URI: "https://localhost:3000/api/connections/instagram/callback",
    },
    () => {
      const connector = new InstagramConnector();
      assert.deepEqual(connector.getMissingConfigVars(), []);
      assert.equal(connector.isConfigured(), true);
    },
  );
});
