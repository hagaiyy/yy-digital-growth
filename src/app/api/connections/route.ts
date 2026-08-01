import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";
import { logSafeDatabaseError } from "@/interfaces/http/databaseDiagnosticLogging";

export async function GET() {
  try {
    const { connectionService } = await createServices();
    const connections = await connectionService.list();
    return NextResponse.json({ connections });
  } catch (error) {
    // createServices() -> getDb() already tags configuration/connection/
    // database/collection stages on its own throws; anything reaching
    // here untagged happened after getDb() resolved, i.e. during
    // connectionService.list()'s repository reads/writes — "query".
    logSafeDatabaseError("api/connections", error, "query");
    return toErrorResponse(error);
  }
}
