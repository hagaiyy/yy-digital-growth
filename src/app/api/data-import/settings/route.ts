import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET() {
  try {
    const { dataImportService } = await createServices();
    const settings = await dataImportService.getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { recentContentLimit?: unknown } | null;
    if (typeof body?.recentContentLimit !== "number") {
      return NextResponse.json(
        { error: { code: "invalidInput", message: "recentContentLimit must be a number." } },
        { status: 400 },
      );
    }
    const { dataImportService } = await createServices();
    const settings = await dataImportService.updateSettings(body.recentContentLimit);
    return NextResponse.json({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}
