import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET() {
  try {
    const { dataImportService } = await createServices();
    const importRun = await dataImportService.getLatestRun();
    return NextResponse.json({ importRun });
  } catch (error) {
    return toErrorResponse(error);
  }
}
