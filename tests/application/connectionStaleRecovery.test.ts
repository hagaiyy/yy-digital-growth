import { test } from "node:test";
import assert from "node:assert/strict";

import { CONNECTION_IDS } from "@/domain/connectionIds";
import { ConnectionService, SafeServiceError } from "@/application/services/ConnectionService";
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
  process.env.APP_ENCRYPTION_KEY = "test-stale-recovery-key";
  try {
    return fn();
  } finally {
    process.env.APP_ENCRYPTION_KEY = original;
  }
}

// A controllable clock lets these tests move "connecting" attempts
// forward past (or keep them short of) the 5-minute staleness window
// without any real sleeping.
function buildService() {
  let currentTime = Date.parse("2026-07-29T12:00:00.000Z");
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
    now: () => new Date(currentTime).toISOString(),
  });

  return {
    service,
    connectionRepository,
    credentialRepository,
    instagramConnector,
    facebookConnector,
    pinterestConnector,
    advanceMinutes: (minutes: number) => {
      currentTime += minutes * 60 * 1000;
    },
  };
}

function stateFor(purpose: string): string {
  return generateOAuthState(purpose, process.env.APP_ENCRYPTION_KEY!);
}

// A "connecting" attempt older than 5 minutes with no completed callback
// must be recovered, not left stuck forever.
test("a connecting attempt older than 5 minutes becomes failed on the next read", async () => {
  await withEncryptionKey(async () => {
    const { service, advanceMinutes } = buildService();
    const { connection: started } = await service.startInstagramConnect();
    assert.equal(started.status, "connecting");
    assert.ok(started.connectionAttemptStartedAt);

    advanceMinutes(6);

    const connections = await service.list();
    const instagram = connections.find((c) => c.connectionId === CONNECTION_IDS.instagram);
    assert.equal(instagram?.status, "failed");
    assert.equal(instagram?.safeErrorCode, "connectionAttemptTimedOut");
    assert.equal(instagram?.safeErrorMessage, "Connection attempt did not complete. Try again.");
    assert.equal(instagram?.connectionAttemptStartedAt, undefined);
  });
});

test("a recent connecting attempt (under 5 minutes) is left alone", async () => {
  await withEncryptionKey(async () => {
    const { service, advanceMinutes } = buildService();
    await service.startFacebookAccountConnect();

    advanceMinutes(2);

    const connections = await service.list();
    const facebook = connections.find((c) => c.connectionId === CONNECTION_IDS.facebookAccount);
    assert.equal(facebook?.status, "connecting");
  });
});

// A "connecting" record with no connectionAttemptStartedAt at all (as
// every record left over from before this fix looks) is treated as
// immediately stale — this is exactly the incident this fix repairs.
test("a legacy connecting record with no connectionAttemptStartedAt is repaired immediately", async () => {
  await withEncryptionKey(async () => {
    const { service, connectionRepository } = buildService();
    await connectionRepository.upsert({
      schemaVersion: "1.0.0",
      connectionId: CONNECTION_IDS.pinterest,
      platform: "pinterest",
      connectionTarget: "account",
      status: "connecting",
      createdAt: "2026-07-29T11:00:00.000Z",
      updatedAt: "2026-07-29T11:00:00.000Z",
    });

    const connections = await service.list();
    const pinterest = connections.find((c) => c.connectionId === CONNECTION_IDS.pinterest);
    assert.notEqual(pinterest?.status, "connecting");
    assert.ok(pinterest?.status === "failed" || pinterest?.status === "setupRequired");
  });
});

// Once required configuration is missing, a stale attempt recovers to
// setupRequired (the honest reason), not a generic "failed".
test("a stale connecting attempt recovers to setupRequired when configuration is missing", async () => {
  await withEncryptionKey(async () => {
    const { service, pinterestConnector, advanceMinutes } = buildService();
    pinterestConnector.configured = true;
    pinterestConnector.missingConfigVars = [];
    await service.startPinterestConnect();

    pinterestConnector.configured = false;
    pinterestConnector.missingConfigVars = ["PINTEREST_APP_ID"];
    advanceMinutes(6);

    const connections = await service.list();
    const pinterest = connections.find((c) => c.connectionId === CONNECTION_IDS.pinterest);
    assert.equal(pinterest?.status, "setupRequired");
    assert.match(pinterest!.safeErrorMessage!, /PINTEREST_APP_ID/);
  });
});

// Denied OAuth (provider returns no code) must not remain connecting.
test("denied OAuth (no code returned) does not remain connecting", async () => {
  await withEncryptionKey(async () => {
    const { service } = buildService();
    await service.startInstagramConnect();
    const { success, connection } = await service.handleInstagramCallback(null, stateFor("instagram"));
    assert.equal(success, false);
    assert.equal(connection.status, "failed");
  });
});

// A connector-level failure during token exchange must not remain
// connecting either.
test("a failed OAuth exchange does not remain connecting", async () => {
  await withEncryptionKey(async () => {
    const { service, facebookConnector } = buildService();
    await service.startFacebookAccountConnect();
    facebookConnector.exchangeResult = new ConnectorError("failed", "Facebook rejected the authorization request.");
    const { success, connection } = await service.handleFacebookAccountCallback(
      "code",
      stateFor("facebook-account"),
    );
    assert.equal(success, false);
    assert.equal(connection.status, "failed");
  });
});

// Missing configuration must resolve to setupRequired, never connecting.
test("starting a connect with missing configuration never enters connecting", async () => {
  await withEncryptionKey(async () => {
    const { service, pinterestConnector } = buildService();
    pinterestConnector.configured = false;
    pinterestConnector.missingConfigVars = ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"];
    const { redirectUrl, connection } = await service.startPinterestConnect();
    assert.equal(redirectUrl, undefined);
    assert.equal(connection.status, "setupRequired");
  });
});

// ---- Reset Connection Attempt ----

test("resetConnectionAttempt clears transient state and returns the card to an actionable status", async () => {
  await withEncryptionKey(async () => {
    const { service, advanceMinutes } = buildService();
    await service.startInstagramConnect();
    advanceMinutes(6);
    await service.list(); // triggers the stale repair, landing on "failed"

    const reset = await service.resetConnectionAttempt(CONNECTION_IDS.instagram);
    assert.equal(reset.status, "notConnected");
    assert.equal(reset.safeErrorCode, undefined);
    assert.equal(reset.safeErrorMessage, undefined);
    assert.equal(reset.connectionAttemptStartedAt, undefined);
  });
});

test("resetConnectionAttempt preserves other platform connections and their credentials", async () => {
  await withEncryptionKey(async () => {
    const { service, credentialRepository } = buildService();
    await service.handleFacebookAccountCallback("code", stateFor("facebook-account"));
    const facebookBefore = await service.getConnection(CONNECTION_IDS.facebookAccount);
    assert.equal(facebookBefore?.status, "connected");

    await service.startInstagramConnect();
    await service.resetConnectionAttempt(CONNECTION_IDS.instagram);

    const facebookAfter = await service.getConnection(CONNECTION_IDS.facebookAccount);
    assert.deepEqual(facebookAfter, facebookBefore);
    assert.ok(await credentialRepository.findByConnectionId(CONNECTION_IDS.facebookAccount));
  });
});

test("resetConnectionAttempt refuses to touch an already-connected account", async () => {
  await withEncryptionKey(async () => {
    const { service, credentialRepository } = buildService();
    await service.handleInstagramCallback("code", stateFor("instagram"));

    await assert.rejects(
      () => service.resetConnectionAttempt(CONNECTION_IDS.instagram),
      (err: unknown) => err instanceof SafeServiceError && err.code === "alreadyConnected",
    );

    const stillConnected = await service.getConnection(CONNECTION_IDS.instagram);
    assert.equal(stillConnected?.status, "connected");
    assert.ok(await credentialRepository.findByConnectionId(CONNECTION_IDS.instagram));
  });
});

test("resetConnectionAttempt rejects an unknown connectionId", async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.resetConnectionAttempt("not-a-real-connection"),
    (err: unknown) => err instanceof SafeServiceError && err.code === "unknownConnection",
  );
});
