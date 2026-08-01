import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importedContentId: string }> },
) {
  try {
    const { importedContentId } = await params;
    const { dataImportService } = await createServices();
    const content = await dataImportService.getImportedContentDetail(importedContentId);
    if (!content) {
      return NextResponse.json(
        { error: { code: "notFound", message: "No such imported content." } },
        { status: 404 },
      );
    }
    const snapshots = await dataImportService.getPerformanceHistory(importedContentId);
    return NextResponse.json({ snapshots });
  } catch (error) {
    return toErrorResponse(error);
  }
}
