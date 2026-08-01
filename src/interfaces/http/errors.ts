import { NextResponse } from "next/server";

import { ConnectorError } from "@/application/connectors/types";
import { SafeServiceError } from "@/application/services/ConnectionService";

// Ensures error responses are always structured, English, and free of
// stack traces or platform-specific raw error bodies — the connectors
// and service already reduce failures down to a safe code + message.
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ConnectorError) {
    const status = error.code === "setupRequired" ? 409 : error.code === "invalidState" ? 400 : 502;
    return NextResponse.json({ error: { code: error.code, message: error.safeMessage } }, { status });
  }
  if (error instanceof SafeServiceError) {
    const status = error.code === "importAlreadyRunning" ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  if (error instanceof Error && error.message.includes("MONGODB_URI")) {
    return NextResponse.json(
      { error: { code: "setupRequired", message: "The database is not configured." } },
      { status: 500 },
    );
  }
  console.error("[api/connections] unexpected error");
  return NextResponse.json(
    { error: { code: "internalError", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}
