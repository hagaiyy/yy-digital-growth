// Stage tagging for database-related failures, shared by GET
// /api/connections and GET /api/health/database. Tags are attached as a
// non-enumerable property on the *original* error object — never wrapped
// in a new Error — so existing error-identity checks elsewhere (e.g.
// instanceof / .message substring checks in toErrorResponse) keep working
// exactly as before. This module never logs or inspects error messages
// itself; it only carries a stage label for a caller-provided logger.

export type DiagnosticStage =
  | "configuration"
  | "connection"
  | "database"
  | "collection"
  | "query"
  | "validation"
  | "decryption"
  | "unknown";

const STAGE_KEY = Symbol("diagnosticStage");

interface StageTagged {
  [STAGE_KEY]?: DiagnosticStage;
}

// Returns the same error instance (or value, for non-Error throws) with
// the stage attached; a non-Error value is returned untouched since there
// is nowhere safe to attach metadata to it.
export function tagDiagnosticStage<T>(error: T, stage: DiagnosticStage): T {
  if (error instanceof Error) {
    Object.defineProperty(error, STAGE_KEY, {
      value: stage,
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

export function getDiagnosticStage(error: unknown): DiagnosticStage | undefined {
  if (error && typeof error === "object") {
    return (error as StageTagged)[STAGE_KEY];
  }
  return undefined;
}
