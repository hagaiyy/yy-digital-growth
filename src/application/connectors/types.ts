import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";

// Thrown by connectors instead of letting a raw fetch/API error escape.
// `safeMessage` must never contain tokens, secrets, request URLs, or any
// other sensitive detail — it is shown to the user and may be logged.
export class ConnectorError extends Error {
  constructor(
    public readonly code: "setupRequired" | "invalidState" | "failed",
    public readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "ConnectorError";
  }
}

export interface VerifiedIdentity {
  externalAccountId: string;
  displayName?: string;
  accountType?: string;
  grantedScopes?: string[];
  expiresAt?: string;
}

export interface PlatformConnector {
  readonly platform: Platform;
  isConfigured(): boolean;
  // Names only — never a value — of environment variables this
  // connector still needs before it can be used.
  getMissingConfigVars(): string[];
}

// One imported content item, already mapped to our internal
// contentType, before it becomes an importedContent record. platformData
// carries the platform's own useful fields once — no separate raw copy.
export interface RecentContentItem {
  externalContentId: string;
  contentType: ContentType;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[];
  permalink?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  platformData: Record<string, unknown>;
}

export type MetricsFetchOutcome =
  | {
      kind: "success";
      metrics: Record<string, number | string | null>;
      dataCompleteness: "complete" | "partial";
    }
  | { kind: "unsupported"; safeMessage: string }
  | { kind: "failed"; safeMessage: string };
