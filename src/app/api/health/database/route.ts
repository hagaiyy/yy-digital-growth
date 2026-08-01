import { NextResponse } from "next/server";

import { getDb } from "@/infrastructure/mongodb/client";
import { getDiagnosticStage, tagDiagnosticStage } from "@/infrastructure/mongodb/diagnostics";
import { logSafeDatabaseError } from "@/interfaces/http/databaseDiagnosticLogging";

// Production-safe database diagnostic. Never returns documents, secrets,
// or raw error messages — only which stage failed, from a closed set of
// safe values. getDb() already exercises configuration/connection/
// database/collection (it also creates indexes, so this surfaces the
// exact same failure GET /api/connections would hit); the ping and count
// below additionally prove the connection is live and platformConnections
// is actually queryable, not just that a cached handle exists.
export async function GET() {
  try {
    const db = await getDb();

    try {
      await db.command({ ping: 1 });
    } catch (error) {
      throw tagDiagnosticStage(error, "connection");
    }

    try {
      await db.collection("platformConnections").estimatedDocumentCount();
    } catch (error) {
      throw tagDiagnosticStage(error, "query");
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    logSafeDatabaseError("api/health/database", error, "unknown");
    const stage = getDiagnosticStage(error) ?? "unknown";
    return NextResponse.json({ status: "error", stage }, { status: 503 });
  }
}
