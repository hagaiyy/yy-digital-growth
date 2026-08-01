import { NextResponse } from "next/server";

import { LocalSetupService } from "@/application/services/LocalSetupService";
import { isLocalDevelopmentAllowed, PRODUCTION_BLOCKED_MESSAGE } from "@/interfaces/http/localSetup";

export async function GET() {
  if (!isLocalDevelopmentAllowed()) {
    return NextResponse.json(
      { error: { code: "productionBlocked", message: PRODUCTION_BLOCKED_MESSAGE } },
      { status: 403 },
    );
  }
  const service = new LocalSetupService();
  return NextResponse.json({ variables: service.getEnvironmentStatus() });
}
