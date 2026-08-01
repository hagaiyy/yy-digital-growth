import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

// Read-only, real server-side proof of Facebook token/permission state —
// never a token, secret, or raw provider response. Requires both the
// Facebook Account and Facebook Page to already be connected.
export async function GET() {
  try {
    const { connectionService } = await createServices();
    const verification = await connectionService.verifyFacebookPagePermissions();
    return NextResponse.json({ verification });
  } catch (error) {
    return toErrorResponse(error);
  }
}
