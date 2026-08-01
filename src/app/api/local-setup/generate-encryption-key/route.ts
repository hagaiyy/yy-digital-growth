import { NextResponse } from "next/server";

import { LocalSetupService } from "@/application/services/LocalSetupService";
import { isLocalDevelopmentAllowed, PRODUCTION_BLOCKED_MESSAGE } from "@/interfaces/http/localSetup";

export async function POST() {
  if (!isLocalDevelopmentAllowed()) {
    return NextResponse.json(
      { error: { code: "productionBlocked", message: PRODUCTION_BLOCKED_MESSAGE } },
      { status: 403 },
    );
  }

  try {
    const service = new LocalSetupService();
    // The generated value is intentionally never included in this
    // response, logged, or returned anywhere — only whether saving it
    // succeeded and whether the running server sees it live yet.
    const result = await service.generateEncryptionKey();
    return NextResponse.json(result);
  } catch {
    console.error("[api/local-setup/generate-encryption-key] unexpected error");
    return NextResponse.json(
      { error: { code: "internalError", message: "An unexpected error occurred while generating the key." } },
      { status: 500 },
    );
  }
}
