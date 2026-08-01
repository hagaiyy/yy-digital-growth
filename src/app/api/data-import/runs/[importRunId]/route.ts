import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importRunId: string }> },
) {
  try {
    const { importRunId } = await params;
    const { dataImportService } = await createServices();
    const importRun = await dataImportService.getRun(importRunId);
    if (!importRun) {
      return NextResponse.json(
        { error: { code: "notFound", message: "No such import run." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ importRun });
  } catch (error) {
    return toErrorResponse(error);
  }
}
