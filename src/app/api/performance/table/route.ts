import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";
import { isContentType, isPlatform } from "@/application/performance/validate";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform");
    const contentType = searchParams.get("contentType");
    if (!isPlatform(platform) || !isContentType(contentType)) {
      return NextResponse.json(
        { error: { code: "invalidInput", message: "platform and contentType query parameters are required and must be valid." } },
        { status: 400 },
      );
    }
    const { performanceViewService } = await createServices();
    const table = await performanceViewService.getTable(platform, contentType);
    return NextResponse.json(table);
  } catch (error) {
    return toErrorResponse(error);
  }
}
