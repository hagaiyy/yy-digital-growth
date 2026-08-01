import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

// Reads from MongoDB only — never from a live platform response.
export async function GET() {
  try {
    const { dataImportService } = await createServices();
    const items = await dataImportService.listImportedContentWithLatestMetrics();
    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}
