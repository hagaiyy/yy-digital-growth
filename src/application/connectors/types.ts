import type { Platform } from "@/domain/models/PlatformConnection";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { MetricRecord } from "@/domain/models/PerformanceSnapshot";

export type { MetricRecord, MetricRecordStatus } from "@/domain/models/PerformanceSnapshot";

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

// Distinct, safe reasons a single metric request can fail — a closed
// classification derived only from the provider's own safe type/code/
// subcode fields, never from a raw free-text error message (which can
// vary and is not something we control or want to expose).
export type MetricFailureReason =
  | "metricUnsupported"
  | "permissionMissing"
  | "invalidMetricForContentType"
  | "requestRejected"
  | "tokenInvalid"
  | "providerError";

export interface MetricFailure {
  metric: string;
  reason: MetricFailureReason;
}

// Meta's own structured error fields — documented for developer support,
// never containing a token, secret, or the free-text message that could
// echo back request details.
export interface MetaSafeError {
  type: string | null;
  code: number | null;
  subcode: number | null;
}

export async function extractMetaSafeError(response: Response): Promise<MetaSafeError | null> {
  try {
    const body = (await response.clone().json()) as {
      error?: { type?: string; code?: number; error_subcode?: number };
    };
    if (!body.error) return null;
    return {
      type: body.error.type ?? null,
      code: body.error.code ?? null,
      subcode: body.error.error_subcode ?? null,
    };
  } catch {
    return null;
  }
}

// A metrics request is always per-metric now — one rejected metric can
// never erase the others fetched alongside it (see MetricFailure above).
// `metricRecords`/`accountType`/`providerMediaType`/`providerMediaProductType`
// are optional additive fields populated by Instagram's connector;
// `providerObjectType` is Facebook's own additive field (its post
// `type`/`status_type`) — Pinterest's existing MetricsFetchOutcome
// producer needs no change either way.
export type MetricsFetchOutcome =
  | {
      // At least one requested metric returned a real value.
      kind: "success";
      metrics: Record<string, number | string | null>;
      successfulMetrics: string[];
      failedMetrics: MetricFailure[];
      dataCompleteness: "complete" | "partial";
      metricRecords?: MetricRecord[];
      accountType?: string;
      providerMediaType?: string;
      providerMediaProductType?: string;
      providerObjectType?: string;
    }
  | {
      // Every requested metric was rejected or does not apply — the
      // content itself is still valid and already saved by the caller.
      // `dataCompleteness` defaults to "unavailable" (a real attempt was
      // made and nothing came back); a connector sets it to "untested"
      // only when there was nothing safe to attempt at all — e.g. a
      // content type with no live-verified or documented candidate
      // metric yet, distinct from metrics that were tried and rejected.
      kind: "unsupported";
      failedMetrics: MetricFailure[];
      safeMessage: string;
      dataCompleteness?: "unavailable" | "untested";
      metricRecords?: MetricRecord[];
      accountType?: string;
      providerMediaType?: string;
      providerMediaProductType?: string;
      providerObjectType?: string;
    }
  | {
      // The metrics attempt itself could not be made at all (e.g. an
      // invalid/expired token, or the network being unreachable) — no
      // individual metric was ever actually requested.
      kind: "failed";
      safeMessage: string;
    };
