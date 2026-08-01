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
