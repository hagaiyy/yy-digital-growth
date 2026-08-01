import { test } from "node:test";
import assert from "node:assert/strict";

import { CONNECTION_IDS } from "@/domain/connectionIds";
import { ConnectionService } from "@/application/services/ConnectionService";
import { ConnectorError } from "@/application/connectors/types";
import { generateOAuthState } from "@/interfaces/http/oauthState";
import {
  InMemoryPlatformConnectionRepository,
  InMemoryPlatformCredentialRepository,
} from "../fakes/InMemoryRepositories";
import {
  FakeFacebookConnector,
  FakeInstagramConnector,
  FakePinterestConnector,
} from "../fakes/FakeConnectors";

function withEncryptionKey<T>(fn: () => T): T {
  const original = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "test-connection-service-key";
  try {
    return fn();
  } finally {
    process.env.APP_ENCRYPTION_KEY = original;
  }
}

function buildService() {
  const connectionRepository = new InMemoryPlatformConnectionRepository();
  const credentialRepository = new InMemoryPlatformCredentialRepository();
  const instagramConnector = new FakeInstagramConnector();
  const facebookConnector = new FakeFacebookConnector();
  const pinterestConnector = new FakePinterestConnector();

  const service = new ConnectionService({
    connectionRepository,
    credentialRepository,
    instagramConnector,
    facebookConnector,
    pinterestConnector,
  });

  return { service, connectionRepository, credentialRepository, instagramConnector, facebookConnector, pinterestConnector };
}

const CREDENTIAL_FIELD_NAMES = [
  "accessToken",
  "refreshToken",
  "authorizationCode",
  "clientSecret",
  "iv",
  "authTag",
  "ciphertext",
];

// Scenario 3: public connection records never contain credentials.
test("public connection records never contain credential fields", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await service.handleInstagramCallback("code", stateFor(service, "instagram"));
    const connections = await service.list();
    for (const connection of connections) {
      for (const field of CREDENTIAL_FIELD_NAMES) {
        assert.ok(!(field in connection), `connection must not contain ${field}`);
      }
    }
  });
});

// Scenario 6: missing APP_ENCRYPTION_KEY prevents plaintext storage / forces setupRequired.
test("missing APP_ENCRYPTION_KEY yields setupRequired instead of a fake connection", async () => {
  const original = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    const { service, credentialRepository } = buildService();
    const { connection } = await service.startInstagramConnect();
    assert.equal(connection.status, "setupRequired");
    assert.equal(await credentialRepository.findByConnectionId(CONNECTION_IDS.instagram), null);
  } finally {
    process.env.APP_ENCRYPTION_KEY = original;
  }
});

// Scenario 7 + 8: status becomes connected only after external verification,
// and Instagram's configured credential is verified through the connector.
test("Instagram becomes connected only after the connector verifies successfully", async () => {
  await withEncryptionKey(async () => {
    const { service, instagramConnector } = buildService();
    const before = await service.list();
    assert.equal(before.find((c) => c.connectionId === CONNECTION_IDS.instagram)?.status, "notConnected");

    const { success, connection } = await service.handleInstagramCallback(
      "code",
      stateFor(service, "instagram"),
    );
    assert.equal(success, true);
    assert.equal(instagramConnector.fetchConnectedInstagramAccountCallCount, 1);
    assert.equal(connection.status, "connected");
    assert.equal(connection.externalAccountId, "ig-external-id");
    assert.equal(connection.displayName, "fake_instagram_user");
  });
});

test("a failed external verification never produces a connected status", async () => {
  await withEncryptionKey(async () => {
    const { service, instagramConnector } = buildService();
    instagramConnector.connectedAccountResult = new ConnectorError(
      "failed",
      "No Instagram professional account is linked to any Facebook Page you manage.",
    );
    const { success, connection } = await service.handleInstagramCallback(
      "code",
      stateFor(service, "instagram"),
    );
    assert.equal(success, false);
    assert.equal(connection.status, "failed");
    assert.equal(
      connection.safeErrorMessage,
      "No Instagram professional account is linked to any Facebook Page you manage.",
    );
  });
});

// Scenario 9: Facebook Account and Facebook Page remain separate.
test("Facebook Account and Facebook Page are separate connection records", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));
    await service.selectFacebookPage("page-1");

    const account = await service.getConnection(CONNECTION_IDS.facebookAccount);
    const page = await service.getConnection(CONNECTION_IDS.facebookPage);
    assert.notEqual(account?.connectionId, page?.connectionId);
    assert.equal(account?.connectionTarget, "account");
    assert.equal(page?.connectionTarget, "page");
  });
});

// Scenario 10: Facebook Page may reference its parent Facebook Account connection.
test("Facebook Page references its parent Facebook Account connectionId", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));
    const page = await service.selectFacebookPage("page-1");
    assert.equal(page.parentConnectionId, CONNECTION_IDS.facebookAccount);
  });
});

// Scenario 11: multiple Pages require explicit user selection.
test("multiple managed Pages are listed and only the explicitly selected one is persisted", async () => {
  await withEncryptionKey(async () => {
    const { service, facebookConnector } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));

    const pages = await service.listFacebookPages();
    assert.equal(pages.length, facebookConnector.managedPages.length);
    assert.ok(pages.length > 1, "fixture must offer more than one Page to prove selection is required");

    const beforeSelection = await service.getConnection(CONNECTION_IDS.facebookPage);
    assert.equal(beforeSelection?.status, "notConnected");

    const page = await service.selectFacebookPage("page-2");
    assert.equal(page.externalAccountId, "page-2");
    assert.equal(page.displayName, "Fake Page Two");
  });
});

test("selecting a Page id that is not in the managed list is rejected", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));
    await assert.rejects(() => service.selectFacebookPage("does-not-exist"));
  });
});

test("Pages cannot be listed before the Facebook Account is connected", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await assert.rejects(() => service.listFacebookPages());
  });
});

// Scenario 15: disconnect removes private credentials.
test("disconnecting Instagram removes its private credential record", async () => {
  await withEncryptionKey(async () => {
    const { service, credentialRepository } = buildService();
    await service.handleInstagramCallback("code", stateFor(service, "instagram"));
    assert.ok(await credentialRepository.findByConnectionId(CONNECTION_IDS.instagram));

    const disconnected = await service.disconnectInstagram();
    assert.equal(disconnected.status, "notConnected");
    assert.equal(await credentialRepository.findByConnectionId(CONNECTION_IDS.instagram), null);
    assert.equal(disconnected.externalAccountId, undefined);
  });
});

test("disconnecting the Facebook Account cascades to remove the Facebook Page credential", async () => {
  await withEncryptionKey(async () => {
    const { service, credentialRepository } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));
    await service.selectFacebookPage("page-1");
    assert.ok(await credentialRepository.findByConnectionId(CONNECTION_IDS.facebookPage));

    await service.disconnectFacebookAccount();
    assert.equal(await credentialRepository.findByConnectionId(CONNECTION_IDS.facebookAccount), null);
    assert.equal(await credentialRepository.findByConnectionId(CONNECTION_IDS.facebookPage), null);
    const page = await service.getConnection(CONNECTION_IDS.facebookPage);
    assert.equal(page?.status, "notConnected");
  });
});

// Scenario 18 + 19: Data Import gating.
test("Data Import is disabled with zero connected accounts", async () => {
  const { service } = buildService();
  assert.equal(await service.isDataImportEnabled(), false);
});

test("Data Import is enabled once at least one account is connected", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    assert.equal(await service.isDataImportEnabled(), false);
    await service.handleInstagramCallback("code", stateFor(service, "instagram"));
    assert.equal(await service.isDataImportEnabled(), true);
  });
});

// Scenario 20: one failed connection does not change the states of other connections.
test("a failed connection does not affect other connections' state", async () => {
  await withEncryptionKey(async () => {
    const { service, instagramConnector } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor(service, "facebook-account"));
    const facebookBefore = await service.getConnection(CONNECTION_IDS.facebookAccount);

    instagramConnector.connectedAccountResult = new ConnectorError(
      "failed",
      "No Instagram professional account is linked to any Facebook Page you manage.",
    );
    await service.handleInstagramCallback("code", stateFor(service, "instagram"));

    const facebookAfter = await service.getConnection(CONNECTION_IDS.facebookAccount);
    assert.deepEqual(facebookAfter, facebookBefore);
  });
});

// Scenario 22: a returning user is not forced to reconnect a valid saved account.
test("listing saved connections never calls out to a connector", async () => {
  await withEncryptionKey(async () => {
    const { service, instagramConnector, facebookConnector, pinterestConnector } = buildService();
    await service.handleInstagramCallback("code", stateFor(service, "instagram"));
    instagramConnector.verifyCallCount = 0;
    instagramConnector.fetchConnectedInstagramAccountCallCount = 0;

    const connections = await service.list();
    assert.equal(connections.find((c) => c.connectionId === CONNECTION_IDS.instagram)?.status, "connected");
    assert.equal(instagramConnector.verifyCallCount, 0);
    assert.equal(instagramConnector.fetchConnectedInstagramAccountCallCount, 0);
    assert.equal(facebookConnector.fetchIdentityCallCount, 0);
    void pinterestConnector;
  });
});

// Scenario 12 (service level): clicking Connect with missing setup
// surfaces exactly which environment variable names are missing, and
// never asks for a manually-supplied access token.
test("Instagram setupRequired names its specific missing application variables, never a user token", async () => {
  await withEncryptionKey(async () => {
    const { service, instagramConnector } = buildService();
    instagramConnector.configured = false;
    instagramConnector.missingConfigVars = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"];
    const { connection } = await service.startInstagramConnect();
    assert.equal(connection.status, "setupRequired");
    for (const name of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"]) {
      assert.match(connection.safeErrorMessage!, new RegExp(name));
    }
    assert.ok(!connection.safeErrorMessage!.includes("INSTAGRAM_ACCESS_TOKEN"));
    assert.ok(!connection.safeErrorMessage!.includes("INSTAGRAM_ACCOUNT_ID"));
    assert.ok(!connection.safeErrorMessage!.includes("META_APP_ID"));
    assert.ok(!connection.safeErrorMessage!.includes("META_APP_SECRET"));
  });
});

test("Facebook Account setupRequired names APP_ENCRYPTION_KEY when that is the only thing missing", async () => {
  const original = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    const { service, facebookConnector } = buildService();
    facebookConnector.configured = true;
    facebookConnector.missingConfigVars = [];
    const { connection } = await service.startFacebookAccountConnect();
    assert.equal(connection.status, "setupRequired");
    assert.match(connection.safeErrorMessage!, /APP_ENCRYPTION_KEY/);
  } finally {
    process.env.APP_ENCRYPTION_KEY = original;
  }
});

test("Pinterest setupRequired names its specific missing environment variables", async () => {
  await withEncryptionKey(async () => {
    const { service, pinterestConnector } = buildService();
    pinterestConnector.configured = false;
    pinterestConnector.missingConfigVars = ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"];
    const { connection } = await service.startPinterestConnect();
    assert.equal(connection.status, "setupRequired");
    for (const name of ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"]) {
      assert.match(connection.safeErrorMessage!, new RegExp(name));
    }
  });
});

function stateFor(service: ConnectionService, purpose: string): string {
  // The callback handlers validate state internally via
  // verifyOAuthState against APP_ENCRYPTION_KEY; generate a real one the
  // same way the matching startXConnect() would, for whichever
  // platform's callback this state is destined for.
  void service;
  return generateOAuthState(purpose, process.env.APP_ENCRYPTION_KEY!);
}
