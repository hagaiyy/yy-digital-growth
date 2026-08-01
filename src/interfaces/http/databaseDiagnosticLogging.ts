import { getDiagnosticStage, type DiagnosticStage } from "@/infrastructure/mongodb/diagnostics";
import { ConnectorError } from "@/application/connectors/types";
import { SafeServiceError } from "@/application/services/ConnectionService";
import { ValidationError } from "@/application/validation/validators";

// Extracts only the fields explicitly approved for logging — never a raw
// error message, since a MongoDB connection error's message can include
// the target host/port derived from MONGODB_URI, and a validation
// error's message could echo back part of a document. Every field below
// is either a fixed class/constructor name, one of our own closed-set
// safe codes, or a MongoDB driver field that is documented as carrying
// no credential material (codeName/code describe the *kind* of server
// error, e.g. "AuthenticationFailed", never the connection string).
interface SafeDatabaseErrorFields {
  route: string;
  errorName: string;
  stage: DiagnosticStage;
  safeErrorCode?: string;
  mongoErrorCodeName?: string;
  mongoErrorCode?: number;
  validationPath?: string;
}

function safeErrorFields(route: string, error: unknown, fallbackStage: DiagnosticStage): SafeDatabaseErrorFields {
  const stage = getDiagnosticStage(error) ?? fallbackStage;

  if (error instanceof ValidationError) {
    return {
      route,
      errorName: error.name,
      stage: "validation",
      validationPath: error.errors?.[0]?.instancePath || undefined,
    };
  }

  if (error instanceof ConnectorError || error instanceof SafeServiceError) {
    return { route, errorName: error.name, stage, safeErrorCode: error.code };
  }

  if (error instanceof Error) {
    // MongoDB driver errors (MongoServerError, MongoServerSelectionError,
    // MongoNetworkError, ...) commonly carry these two fields describing
    // the server-reported failure kind — duck-typed rather than importing
    // the mongodb error classes, since not every such error extends a
    // single common exported base in a way worth depending on here.
    const withMongoFields = error as Error & { codeName?: unknown; code?: unknown };
    const mongoErrorCodeName =
      typeof withMongoFields.codeName === "string" ? withMongoFields.codeName : undefined;
    const mongoErrorCode = typeof withMongoFields.code === "number" ? withMongoFields.code : undefined;
    return { route, errorName: error.name, stage, mongoErrorCodeName, mongoErrorCode };
  }

  return { route, errorName: "UnknownError", stage: "unknown" };
}

// Logs one structured, safe diagnostic line for a database-related
// failure. Never includes MONGODB_URI, credentials, tokens,
// APP_ENCRYPTION_KEY, encrypted credential values, full documents, or any
// raw error message.
export function logSafeDatabaseError(route: string, error: unknown, fallbackStage: DiagnosticStage): void {
  console.error(JSON.stringify(safeErrorFields(route, error, fallbackStage)));
}
