import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { pageId?: unknown } | null;
    const pageId = typeof body?.pageId === "string" ? body.pageId : null;
    if (!pageId) {
      return NextResponse.json(
        { error: { code: "invalidInput", message: "pageId is required." } },
        { status: 400 },
      );
    }
    const { connectionService } = await createServices();
    const connection = await connectionService.selectFacebookPage(pageId);
    return NextResponse.json({ connection });
  } catch (error) {
    return toErrorResponse(error);
  }
}
