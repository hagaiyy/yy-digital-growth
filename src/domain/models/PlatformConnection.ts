export type Platform = "instagram" | "facebook" | "pinterest";

export type ConnectionTarget = "account" | "page";

export type ConnectionStatus =
  | "notConnected"
  | "setupRequired"
  | "connecting"
  | "connected"
  | "expired"
  | "failed";

export interface PlatformConnection {
  schemaVersion: "1.0.0";
  connectionId: string;
  platform: Platform;
  connectionTarget: ConnectionTarget;
  status: ConnectionStatus;
  externalAccountId?: string;
  displayName?: string;
  accountType?: string;
  grantedScopes?: string[];
  connectedAt?: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  safeErrorCode?: string;
  safeErrorMessage?: string;
  parentConnectionId?: string;
  // Set only while status is "connecting", to when that attempt began —
  // lets a later read detect an attempt the user never completed (tab
  // closed, provider rejected the request before ever redirecting back)
  // and recover it instead of leaving the card stuck forever. Cleared on
  // every other status transition.
  connectionAttemptStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Facebook Account is only an authorization identity used to discover
// managed Pages. Meta's own API proves (GET /me/posts returns zero posts
// without Advanced Access this app does not have — verified live, not
// assumed) that it can never be a real content source, so it is excluded
// from Data Import eligibility regardless of connection status. Every
// other connected source (Instagram, Facebook Page) is eligible.
export function isEligibleDataImportSource(connection: Pick<PlatformConnection, "status" | "platform" | "connectionTarget">): boolean {
  if (connection.status !== "connected") return false;
  if (connection.platform === "facebook" && connection.connectionTarget === "account") return false;
  return true;
}
