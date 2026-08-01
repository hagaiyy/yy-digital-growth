import { CONNECTION_IDS } from "@/domain/connectionIds";
import {
  isEligibleDataImportSource,
  type ConnectionStatus,
  type ConnectionTarget,
  type Platform,
  type PlatformConnection,
} from "@/domain/models/PlatformConnection";
import type { PlatformConnectionRepository } from "@/domain/repositories/PlatformConnectionRepository";
import type { PlatformCredentialRepository } from "@/domain/repositories/PlatformCredentialRepository";

import type { FacebookConnector, FacebookTokenVerificationResult } from "@/application/connectors/FacebookConnector";
import type { InstagramConnector } from "@/application/connectors/InstagramConnector";
import type { PinterestConnector } from "@/application/connectors/PinterestConnector";
import { ConnectorError } from "@/application/connectors/types";

import { decryptCredential, encryptCredential, isEncryptionAvailable } from "@/infrastructure/crypto/encryption";
import { generateOAuthState, verifyOAuthState } from "@/interfaces/http/oauthState";

export class SafeServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SafeServiceError";
  }
}

interface ConnectionDefinition {
  connectionId: string;
  platform: Platform;
  connectionTarget: ConnectionTarget;
  parentConnectionId?: string;
}

const DEFINITIONS: ConnectionDefinition[] = [
  { connectionId: CONNECTION_IDS.instagram, platform: "instagram", connectionTarget: "account" },
  { connectionId: CONNECTION_IDS.facebookAccount, platform: "facebook", connectionTarget: "account" },
  {
    connectionId: CONNECTION_IDS.facebookPage,
    platform: "facebook",
    connectionTarget: "page",
    parentConnectionId: CONNECTION_IDS.facebookAccount,
  },
  { connectionId: CONNECTION_IDS.pinterest, platform: "pinterest", connectionTarget: "account" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
};

// A "connecting" record with no active redirect in flight (the user
// closed the tab, the provider rejected the request before ever
// returning to our callback, or the process restarted mid-flow) must
// never stay that way forever — this is how long a genuine redirect is
// given before a read treats it as abandoned and recovers it.
const STALE_CONNECTING_MS = 5 * 60 * 1000;

export interface ConnectionServiceDependencies {
  connectionRepository: PlatformConnectionRepository;
  credentialRepository: PlatformCredentialRepository;
  instagramConnector: InstagramConnector;
  facebookConnector: FacebookConnector;
  pinterestConnector: PinterestConnector;
  now?: () => string;
}

export class ConnectionService {
  private readonly connectionRepository: PlatformConnectionRepository;
  private readonly credentialRepository: PlatformCredentialRepository;
  private readonly instagramConnector: InstagramConnector;
  private readonly facebookConnector: FacebookConnector;
  private readonly pinterestConnector: PinterestConnector;
  private readonly now: () => string;

  constructor(deps: ConnectionServiceDependencies) {
    this.connectionRepository = deps.connectionRepository;
    this.credentialRepository = deps.credentialRepository;
    this.instagramConnector = deps.instagramConnector;
    this.facebookConnector = deps.facebookConnector;
    this.pinterestConnector = deps.pinterestConnector;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private connectorFor(platform: Platform) {
    if (platform === "instagram") return this.instagramConnector;
    if (platform === "facebook") return this.facebookConnector;
    return this.pinterestConnector;
  }

  private isEligible(platform: Platform): boolean {
    return this.connectorFor(platform).isConfigured() && isEncryptionAvailable();
  }

  // Names only — never a value — combining a connector's own missing
  // variables with APP_ENCRYPTION_KEY, so a single click surfaces
  // everything that still needs to be set at once.
  private missingVarsFor(platform: Platform): string[] {
    const missing = [...this.connectorFor(platform).getMissingConfigVars()];
    if (!isEncryptionAvailable()) missing.push("APP_ENCRYPTION_KEY");
    return missing;
  }

  private buildSetupRequiredMessage(platform: Platform, label: string): string {
    const missing = this.missingVarsFor(platform);
    return `${label} is not configured. Missing environment variable(s): ${missing.join(", ")}.`;
  }

  private buildDefaultView(def: ConnectionDefinition): PlatformConnection {
    const timestamp = this.now();
    const status: ConnectionStatus = this.isEligible(def.platform) ? "notConnected" : "setupRequired";
    return {
      schemaVersion: "1.0.0",
      connectionId: def.connectionId,
      platform: def.platform,
      connectionTarget: def.connectionTarget,
      status,
      ...(def.parentConnectionId ? { parentConnectionId: def.parentConnectionId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  // Pure read: never calls out to any connector, so a returning user with
  // a valid saved connection is never forced through re-authorization
  // just to view the Main Dashboard. Still repairs any "connecting"
  // record whose attempt has gone stale, so a card can never stay stuck
  // on "Connecting..." forever just because the user viewed it.
  async list(): Promise<PlatformConnection[]> {
    const stored = await this.connectionRepository.list();
    const storedById = new Map(stored.map((connection) => [connection.connectionId, connection]));
    const results: PlatformConnection[] = [];
    for (const def of DEFINITIONS) {
      const connection = storedById.get(def.connectionId) ?? this.buildDefaultView(def);
      results.push(await this.repairIfStaleConnecting(def, connection));
    }
    return results;
  }

  async getConnection(connectionId: string): Promise<PlatformConnection | null> {
    const def = DEFINITIONS.find((d) => d.connectionId === connectionId);
    if (!def) return null;
    const existing = await this.connectionRepository.findByConnectionId(connectionId);
    const connection = existing ?? this.buildDefaultView(def);
    return this.repairIfStaleConnecting(def, connection);
  }

  // No connectionAttemptStartedAt at all means this record was left
  // "connecting" by code that predates this timestamp (or a bug) — under
  // the current code that field is always set the moment a redirect is
  // started, so its absence on a "connecting" record is itself proof
  // there is no attempt this process is tracking, and it is treated as
  // immediately stale rather than waited out.
  private isStaleConnecting(connection: PlatformConnection): boolean {
    if (connection.status !== "connecting") return false;
    if (!connection.connectionAttemptStartedAt) return true;
    const startedAtMs = Date.parse(connection.connectionAttemptStartedAt);
    if (Number.isNaN(startedAtMs)) return true;
    return Date.parse(this.now()) - startedAtMs > STALE_CONNECTING_MS;
  }

  private async repairIfStaleConnecting(
    def: ConnectionDefinition,
    connection: PlatformConnection,
  ): Promise<PlatformConnection> {
    if (!this.isStaleConnecting(connection)) return connection;
    if (!this.isEligible(def.platform)) {
      return this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage(def.platform, PLATFORM_LABELS[def.platform]),
      });
    }
    return this.persistStatus(def, {
      status: "failed",
      safeErrorCode: "connectionAttemptTimedOut",
      safeErrorMessage: "Connection attempt did not complete. Try again.",
    });
  }

  // A user-triggered escape hatch for a stuck or failed attempt that
  // doesn't require waiting out the automatic stale-connecting recovery.
  // Clears only this connection's own transient attempt state — it never
  // touches a stored credential (so a genuinely connected account is
  // untouched) and never touches any other connectionId.
  async resetConnectionAttempt(connectionId: string): Promise<PlatformConnection> {
    const def = DEFINITIONS.find((d) => d.connectionId === connectionId);
    if (!def) {
      throw new SafeServiceError("unknownConnection", "Unknown connectionId.");
    }
    const existing = await this.connectionRepository.findByConnectionId(connectionId);
    if (existing?.status === "connected") {
      throw new SafeServiceError(
        "alreadyConnected",
        "This connection is already connected. Disconnect it instead of resetting.",
      );
    }
    return this.persistStatus(def, {
      status: this.isEligible(def.platform) ? "notConnected" : "setupRequired",
      ...(this.isEligible(def.platform)
        ? {}
        : {
            safeErrorCode: "setupRequired",
            safeErrorMessage: this.buildSetupRequiredMessage(def.platform, PLATFORM_LABELS[def.platform]),
          }),
      ...(def.parentConnectionId ? { parentConnectionId: def.parentConnectionId } : {}),
    });
  }

  // Additive for the Data Import phase: the only way any code outside
  // this service can obtain a usable credential for a connected source,
  // so decryption stays centralized here rather than duplicated
  // wherever an authenticated platform call is needed. Returns null for
  // anything not currently connected — callers must not assume the
  // presence of a connection implies a usable credential.
  async getDecryptedCredential(connectionId: string): Promise<Record<string, unknown> | null> {
    const connection = await this.connectionRepository.findByConnectionId(connectionId);
    if (!connection || connection.status !== "connected") return null;
    const credential = await this.credentialRepository.findByConnectionId(connectionId);
    if (!credential) return null;
    return decryptCredential(credential);
  }

  async isDataImportEnabled(): Promise<boolean> {
    const connections = await this.list();
    return connections.some((connection) => isEligibleDataImportSource(connection));
  }

  private async persistStatus(
    def: ConnectionDefinition,
    fields: Partial<PlatformConnection>,
  ): Promise<PlatformConnection> {
    const existing = await this.connectionRepository.findByConnectionId(def.connectionId);
    const timestamp = this.now();
    const record: PlatformConnection = {
      schemaVersion: "1.0.0",
      connectionId: def.connectionId,
      platform: def.platform,
      connectionTarget: def.connectionTarget,
      status: "notConnected",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...fields,
    };
    return this.connectionRepository.upsert(record);
  }

  private async resetToNotConnected(def: ConnectionDefinition): Promise<PlatformConnection> {
    return this.persistStatus(def, {
      status: this.isEligible(def.platform) ? "notConnected" : "setupRequired",
      externalAccountId: undefined,
      displayName: undefined,
      accountType: undefined,
      grantedScopes: undefined,
      connectedAt: undefined,
      lastVerifiedAt: undefined,
      expiresAt: undefined,
      safeErrorCode: undefined,
      safeErrorMessage: undefined,
      ...(def.parentConnectionId ? { parentConnectionId: def.parentConnectionId } : { parentConnectionId: undefined }),
    });
  }

  private async persistConnectorError(
    def: ConnectionDefinition,
    error: ConnectorError,
  ): Promise<PlatformConnection> {
    return this.persistStatus(def, {
      status: error.code === "setupRequired" ? "setupRequired" : "failed",
      safeErrorCode: error.code,
      safeErrorMessage: error.safeMessage,
    });
  }

  // ---- Instagram ----
  // Interactive OAuth, identical in shape to the Facebook Account flow
  // below — there is no environment-supplied user access token anywhere
  // in this path.

  async startInstagramConnect(): Promise<{ redirectUrl?: string; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.instagram)!;
    if (!this.isEligible("instagram")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("instagram", "Instagram"),
      });
      return { connection };
    }
    const state = generateOAuthState("instagram", process.env.APP_ENCRYPTION_KEY!);
    const redirectUrl = this.instagramConnector.buildAuthorizationUrl(state);
    const connection = await this.persistStatus(def, {
      status: "connecting",
      connectionAttemptStartedAt: this.now(),
    });
    return { redirectUrl, connection };
  }

  async handleInstagramCallback(
    code: string | null,
    state: string | null,
  ): Promise<{ success: boolean; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.instagram)!;

    if (!this.isEligible("instagram")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("instagram", "Instagram"),
      });
      return { success: false, connection };
    }

    if (!code || !verifyOAuthState(state, "instagram", process.env.APP_ENCRYPTION_KEY!)) {
      const connection = await this.persistStatus(def, {
        status: "failed",
        safeErrorCode: "invalidState",
        safeErrorMessage: "The Instagram authorization response could not be verified. Please try connecting again.",
      });
      return { success: false, connection };
    }

    try {
      const tokenSet = await this.instagramConnector.exchangeCodeForToken(code);
      const identity = await this.instagramConnector.fetchConnectedInstagramAccount(tokenSet.accessToken);

      await this.credentialRepository.save({
        connectionId: def.connectionId,
        ...encryptCredential({
          accessToken: tokenSet.accessToken,
          accountId: identity.externalAccountId,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      });

      const existing = await this.connectionRepository.findByConnectionId(def.connectionId);
      const timestamp = this.now();
      const connection = await this.persistStatus(def, {
        status: "connected",
        externalAccountId: identity.externalAccountId,
        displayName: identity.displayName,
        accountType: identity.accountType,
        grantedScopes: identity.grantedScopes,
        expiresAt: tokenSet.expiresAt,
        connectedAt: existing?.status === "connected" ? existing.connectedAt : timestamp,
        lastVerifiedAt: timestamp,
        safeErrorCode: undefined,
        safeErrorMessage: undefined,
      });
      return { success: true, connection };
    } catch (error) {
      if (error instanceof ConnectorError) {
        const connection = await this.persistConnectorError(def, error);
        return { success: false, connection };
      }
      throw error;
    }
  }

  async disconnectInstagram(): Promise<PlatformConnection> {
    await this.credentialRepository.delete(CONNECTION_IDS.instagram);
    return this.resetToNotConnected(DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.instagram)!);
  }

  // ---- Facebook Account ----

  async startFacebookAccountConnect(): Promise<{ redirectUrl?: string; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookAccount)!;
    if (!this.isEligible("facebook")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("facebook", "Facebook"),
      });
      return { connection };
    }
    const state = generateOAuthState("facebook-account", process.env.APP_ENCRYPTION_KEY!);
    const redirectUrl = this.facebookConnector.buildAuthorizationUrl(state);
    const connection = await this.persistStatus(def, {
      status: "connecting",
      connectionAttemptStartedAt: this.now(),
    });
    return { redirectUrl, connection };
  }

  async handleFacebookAccountCallback(
    code: string | null,
    state: string | null,
  ): Promise<{ success: boolean; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookAccount)!;

    if (!this.isEligible("facebook")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("facebook", "Facebook"),
      });
      return { success: false, connection };
    }

    if (!code || !verifyOAuthState(state, "facebook-account", process.env.APP_ENCRYPTION_KEY!)) {
      const connection = await this.persistStatus(def, {
        status: "failed",
        safeErrorCode: "invalidState",
        safeErrorMessage: "The Facebook authorization response could not be verified. Please try connecting again.",
      });
      return { success: false, connection };
    }

    try {
      const accessToken = await this.facebookConnector.exchangeCodeForToken(code);
      const identity = await this.facebookConnector.fetchIdentity(accessToken);

      await this.credentialRepository.save({
        connectionId: def.connectionId,
        ...encryptCredential({ accessToken }),
        createdAt: this.now(),
        updatedAt: this.now(),
      });

      const existing = await this.connectionRepository.findByConnectionId(def.connectionId);
      const timestamp = this.now();
      const connection = await this.persistStatus(def, {
        status: "connected",
        externalAccountId: identity.externalAccountId,
        displayName: identity.displayName,
        accountType: identity.accountType,
        grantedScopes: identity.grantedScopes,
        connectedAt: existing?.status === "connected" ? existing.connectedAt : timestamp,
        lastVerifiedAt: timestamp,
        safeErrorCode: undefined,
        safeErrorMessage: undefined,
      });
      return { success: true, connection };
    } catch (error) {
      if (error instanceof ConnectorError) {
        const connection = await this.persistConnectorError(def, error);
        return { success: false, connection };
      }
      throw error;
    }
  }

  async disconnectFacebookAccount(): Promise<PlatformConnection> {
    await this.credentialRepository.delete(CONNECTION_IDS.facebookAccount);
    const accountDef = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookAccount)!;
    const accountConnection = await this.resetToNotConnected(accountDef);

    // The Facebook Page connection's authorization is rooted in the
    // Facebook Account's session; disconnecting the account cascades to
    // the Page so a stale, orphaned "connected" Page never survives its
    // parent's disconnection.
    await this.credentialRepository.delete(CONNECTION_IDS.facebookPage);
    const pageDef = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookPage)!;
    await this.resetToNotConnected(pageDef);

    return accountConnection;
  }

  // ---- Facebook Page ----

  private async getConnectedFacebookAccountToken(): Promise<string> {
    const accountConnection = await this.connectionRepository.findByConnectionId(
      CONNECTION_IDS.facebookAccount,
    );
    if (!accountConnection || accountConnection.status !== "connected") {
      throw new SafeServiceError(
        "facebookAccountNotConnected",
        "Facebook Account must be connected before Pages can be managed.",
      );
    }
    const credential = await this.credentialRepository.findByConnectionId(CONNECTION_IDS.facebookAccount);
    if (!credential) {
      throw new SafeServiceError(
        "facebookAccountNotConnected",
        "Facebook Account must be connected before Pages can be managed.",
      );
    }
    const decrypted = decryptCredential(credential);
    return decrypted.accessToken as string;
  }

  async listFacebookPages(): Promise<Array<{ id: string; name: string; category?: string }>> {
    const accountAccessToken = await this.getConnectedFacebookAccountToken();
    const pages = await this.facebookConnector.fetchManagedPages(accountAccessToken);
    return pages.map((page) => ({ id: page.id, name: page.name, category: page.category }));
  }

  async selectFacebookPage(pageId: string): Promise<PlatformConnection> {
    const accountAccessToken = await this.getConnectedFacebookAccountToken();
    const pages = await this.facebookConnector.fetchManagedPages(accountAccessToken);
    const match = pages.find((page) => page.id === pageId);
    if (!match) {
      throw new SafeServiceError(
        "pageNotFound",
        "The selected Page is no longer available. Please refresh and select again.",
      );
    }

    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookPage)!;
    await this.credentialRepository.save({
      connectionId: def.connectionId,
      ...encryptCredential({ accessToken: match.accessToken }),
      createdAt: this.now(),
      updatedAt: this.now(),
    });

    const timestamp = this.now();
    return this.persistStatus(def, {
      status: "connected",
      externalAccountId: match.id,
      displayName: match.name,
      accountType: match.category,
      grantedScopes: [],
      parentConnectionId: CONNECTION_IDS.facebookAccount,
      connectedAt: timestamp,
      lastVerifiedAt: timestamp,
      safeErrorCode: undefined,
      safeErrorMessage: undefined,
    });
  }

  async disconnectFacebookPage(): Promise<PlatformConnection> {
    await this.credentialRepository.delete(CONNECTION_IDS.facebookPage);
    return this.resetToNotConnected(DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.facebookPage)!);
  }

  // Real server-side proof of token/permission state for both the
  // Facebook Account (user) token and the Facebook Page token — never
  // inferred from stored `grantedScopes` or from what was requested at
  // authorization time. Throws SafeServiceError if either connection
  // isn't actually connected yet, rather than returning a
  // misleadingly-false verification result.
  async verifyFacebookPagePermissions(): Promise<FacebookTokenVerificationResult> {
    const [accountCredential, pageConnection, pageCredential] = await Promise.all([
      this.credentialRepository.findByConnectionId(CONNECTION_IDS.facebookAccount),
      this.connectionRepository.findByConnectionId(CONNECTION_IDS.facebookPage),
      this.credentialRepository.findByConnectionId(CONNECTION_IDS.facebookPage),
    ]);
    if (!accountCredential) {
      throw new SafeServiceError("facebookAccountNotConnected", "Facebook Account is not connected.");
    }
    if (!pageConnection || !pageConnection.externalAccountId || !pageCredential) {
      throw new SafeServiceError("facebookPageNotConnected", "Facebook Page is not connected.");
    }
    const { accessToken: userAccessToken } = decryptCredential(accountCredential) as { accessToken: string };
    const { accessToken: pageAccessToken } = decryptCredential(pageCredential) as { accessToken: string };
    return this.facebookConnector.verifyTokenState(userAccessToken, pageAccessToken, pageConnection.externalAccountId);
  }

  // ---- Pinterest ----

  async startPinterestConnect(): Promise<{ redirectUrl?: string; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.pinterest)!;
    if (!this.isEligible("pinterest")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("pinterest", "Pinterest"),
      });
      return { connection };
    }
    const state = generateOAuthState("pinterest", process.env.APP_ENCRYPTION_KEY!);
    const redirectUrl = this.pinterestConnector.buildAuthorizationUrl(state);
    const connection = await this.persistStatus(def, {
      status: "connecting",
      connectionAttemptStartedAt: this.now(),
    });
    return { redirectUrl, connection };
  }

  async handlePinterestCallback(
    code: string | null,
    state: string | null,
  ): Promise<{ success: boolean; connection: PlatformConnection }> {
    const def = DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.pinterest)!;

    if (!this.isEligible("pinterest")) {
      const connection = await this.persistStatus(def, {
        status: "setupRequired",
        safeErrorCode: "setupRequired",
        safeErrorMessage: this.buildSetupRequiredMessage("pinterest", "Pinterest"),
      });
      return { success: false, connection };
    }

    if (!code || !verifyOAuthState(state, "pinterest", process.env.APP_ENCRYPTION_KEY!)) {
      const connection = await this.persistStatus(def, {
        status: "failed",
        safeErrorCode: "invalidState",
        safeErrorMessage: "The Pinterest authorization response could not be verified. Please try connecting again.",
      });
      return { success: false, connection };
    }

    try {
      const tokenSet = await this.pinterestConnector.exchangeCodeForToken(code);
      const identity = await this.pinterestConnector.fetchIdentity(tokenSet.accessToken);

      await this.credentialRepository.save({
        connectionId: def.connectionId,
        ...encryptCredential({
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      });

      const existing = await this.connectionRepository.findByConnectionId(def.connectionId);
      const timestamp = this.now();
      const connection = await this.persistStatus(def, {
        status: "connected",
        externalAccountId: identity.externalAccountId,
        displayName: identity.displayName,
        accountType: identity.accountType,
        grantedScopes: identity.grantedScopes,
        expiresAt: tokenSet.expiresAt,
        connectedAt: existing?.status === "connected" ? existing.connectedAt : timestamp,
        lastVerifiedAt: timestamp,
        safeErrorCode: undefined,
        safeErrorMessage: undefined,
      });
      return { success: true, connection };
    } catch (error) {
      if (error instanceof ConnectorError) {
        const connection = await this.persistConnectorError(def, error);
        return { success: false, connection };
      }
      throw error;
    }
  }

  async disconnectPinterest(): Promise<PlatformConnection> {
    await this.credentialRepository.delete(CONNECTION_IDS.pinterest);
    return this.resetToNotConnected(DEFINITIONS.find((d) => d.connectionId === CONNECTION_IDS.pinterest)!);
  }

  // ---- Generic re-verify ----

  async verifyConnection(connectionId: string): Promise<PlatformConnection> {
    if (connectionId === CONNECTION_IDS.instagram) {
      const def = DEFINITIONS.find((d) => d.connectionId === connectionId)!;
      const [connection, credential] = await Promise.all([
        this.connectionRepository.findByConnectionId(connectionId),
        this.credentialRepository.findByConnectionId(connectionId),
      ]);
      if (!connection || !credential || !connection.externalAccountId) {
        throw new SafeServiceError("notConnected", "This connection has not been established yet.");
      }
      try {
        const { accessToken } = decryptCredential(credential) as { accessToken: string };
        const identity = await this.instagramConnector.verifyAccountStillValid(accessToken);
        return this.persistStatus(def, {
          status: "connected",
          externalAccountId: identity.externalAccountId,
          displayName: identity.displayName,
          accountType: identity.accountType,
          lastVerifiedAt: this.now(),
          safeErrorCode: undefined,
          safeErrorMessage: undefined,
        });
      } catch (error) {
        if (error instanceof ConnectorError) {
          return this.persistStatus(def, {
            status: "expired",
            safeErrorCode: error.code,
            safeErrorMessage: error.safeMessage,
          });
        }
        throw error;
      }
    }

    if (connectionId === CONNECTION_IDS.facebookAccount) {
      const def = DEFINITIONS.find((d) => d.connectionId === connectionId)!;
      const credential = await this.credentialRepository.findByConnectionId(connectionId);
      if (!credential) {
        throw new SafeServiceError("notConnected", "This connection has not been established yet.");
      }
      try {
        const { accessToken } = decryptCredential(credential) as { accessToken: string };
        const identity = await this.facebookConnector.fetchIdentity(accessToken);
        return this.persistStatus(def, {
          status: "connected",
          externalAccountId: identity.externalAccountId,
          displayName: identity.displayName,
          accountType: identity.accountType,
          lastVerifiedAt: this.now(),
          safeErrorCode: undefined,
          safeErrorMessage: undefined,
        });
      } catch (error) {
        if (error instanceof ConnectorError) {
          return this.persistStatus(def, {
            status: "expired",
            safeErrorCode: error.code,
            safeErrorMessage: error.safeMessage,
          });
        }
        throw error;
      }
    }

    if (connectionId === CONNECTION_IDS.facebookPage) {
      const def = DEFINITIONS.find((d) => d.connectionId === connectionId)!;
      const [connection, credential] = await Promise.all([
        this.connectionRepository.findByConnectionId(connectionId),
        this.credentialRepository.findByConnectionId(connectionId),
      ]);
      if (!connection || !credential || !connection.externalAccountId) {
        throw new SafeServiceError("notConnected", "This connection has not been established yet.");
      }
      try {
        const { accessToken } = decryptCredential(credential) as { accessToken: string };
        const identity = await this.facebookConnector.verifyPageStillManaged(
          connection.externalAccountId,
          accessToken,
        );
        return this.persistStatus(def, {
          status: "connected",
          externalAccountId: identity.externalAccountId,
          displayName: identity.displayName,
          accountType: identity.accountType,
          parentConnectionId: CONNECTION_IDS.facebookAccount,
          lastVerifiedAt: this.now(),
          safeErrorCode: undefined,
          safeErrorMessage: undefined,
        });
      } catch (error) {
        if (error instanceof ConnectorError) {
          return this.persistStatus(def, {
            status: "expired",
            parentConnectionId: CONNECTION_IDS.facebookAccount,
            safeErrorCode: error.code,
            safeErrorMessage: error.safeMessage,
          });
        }
        throw error;
      }
    }

    if (connectionId === CONNECTION_IDS.pinterest) {
      const def = DEFINITIONS.find((d) => d.connectionId === connectionId)!;
      const credential = await this.credentialRepository.findByConnectionId(connectionId);
      if (!credential) {
        throw new SafeServiceError("notConnected", "This connection has not been established yet.");
      }
      const decrypted = decryptCredential(credential) as { accessToken: string; refreshToken?: string };
      try {
        const identity = await this.pinterestConnector.fetchIdentity(decrypted.accessToken);
        return this.persistStatus(def, {
          status: "connected",
          externalAccountId: identity.externalAccountId,
          displayName: identity.displayName,
          accountType: identity.accountType,
          lastVerifiedAt: this.now(),
          safeErrorCode: undefined,
          safeErrorMessage: undefined,
        });
      } catch (firstError) {
        if (firstError instanceof ConnectorError && decrypted.refreshToken) {
          try {
            const refreshed = await this.pinterestConnector.refreshAccessToken(decrypted.refreshToken);
            const identity = await this.pinterestConnector.fetchIdentity(refreshed.accessToken);
            await this.credentialRepository.save({
              connectionId: def.connectionId,
              ...encryptCredential({
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? decrypted.refreshToken,
              }),
              createdAt: this.now(),
              updatedAt: this.now(),
            });
            return this.persistStatus(def, {
              status: "connected",
              externalAccountId: identity.externalAccountId,
              displayName: identity.displayName,
              accountType: identity.accountType,
              expiresAt: refreshed.expiresAt,
              lastVerifiedAt: this.now(),
              safeErrorCode: undefined,
              safeErrorMessage: undefined,
            });
          } catch (refreshError) {
            if (refreshError instanceof ConnectorError) {
              return this.persistStatus(def, {
                status: "expired",
                safeErrorCode: refreshError.code,
                safeErrorMessage: refreshError.safeMessage,
              });
            }
            throw refreshError;
          }
        }
        if (firstError instanceof ConnectorError) {
          return this.persistStatus(def, {
            status: "expired",
            safeErrorCode: firstError.code,
            safeErrorMessage: firstError.safeMessage,
          });
        }
        throw firstError;
      }
    }

    throw new SafeServiceError("unknownConnection", "Unknown connectionId.");
  }
}
