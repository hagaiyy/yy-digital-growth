import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET() {
  try {
    const { connectionService } = await createServices();
    const pages = await connectionService.listFacebookPages();
    return NextResponse.json({ pages });
  } catch (error) {
    return toErrorResponse(error);
  }
}
