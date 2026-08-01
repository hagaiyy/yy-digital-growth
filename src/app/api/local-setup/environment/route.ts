import { NextResponse } from "next/server";

import { LocalSetupService } from "@/application/services/LocalSetupService";
import { SafeServiceError } from "@/application/services/ConnectionService";
import { isLocalDevelopmentAllowed, PRODUCTION_BLOCKED_MESSAGE } from "@/interfaces/http/localSetup";

export async function POST(request: Request) {
  if (!isLocalDevelopmentAllowed()) {
    return NextResponse.json(
      { error: { code: "productionBlocked", message: PRODUCTION_BLOCKED_MESSAGE } },
      { status: 403 },
    );
  }

  let body: { values?: unknown } | null;
  try {
    body = (await request.json()) as { values?: unknown };
  } catch {
    // Never echo the unparseable body back in the error.
    return NextResponse.json(
      { error: { code: "invalidRequest", message: "The request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (!body || typeof body.values !== "object" || body.values === null || Array.isArray(body.values)) {
    return NextResponse.json(
      { error: { code: "invalidRequest", message: "Expected a \"values\" object of variable name to value." } },
      { status: 400 },
    );
  }

  try {
    const service = new LocalSetupService();
    const result = await service.saveEnvironmentValues(body.values as Record<string, unknown>);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SafeServiceError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    // Never log or include the submitted values here.
    console.error("[api/local-setup/environment] unexpected error");
    return NextResponse.json(
      { error: { code: "internalError", message: "An unexpected error occurred while saving configuration." } },
      { status: 500 },
    );
  }
}
