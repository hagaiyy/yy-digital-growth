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
    const hiddenMetrics = await performanceViewService.getHiddenMetrics(platform, contentType);
    return NextResponse.json({ hiddenMetrics });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { platform?: unknown; contentType?: unknown; hiddenMetrics?: unknown }
      | null;
    const platform = body?.platform;
    const contentType = body?.contentType;
    const hiddenMetrics = body?.hiddenMetrics;
    if (
      !isPlatform(platform) ||
      !isContentType(contentType) ||
      !Array.isArray(hiddenMetrics) ||
      !hiddenMetrics.every((m) => typeof m === "string")
    ) {
      return NextResponse.json(
        {
          error: {
            code: "invalidInput",
            message: "platform, contentType, and hiddenMetrics (string array) are required.",
          },
        },
        { status: 400 },
      );
    }
    const { performanceViewService } = await createServices();
    const saved = await performanceViewService.setHiddenMetrics(platform, contentType, hiddenMetrics as string[]);
    return NextResponse.json({ hiddenMetrics: saved });
  } catch (error) {
    return toErrorResponse(error);
  }
}
