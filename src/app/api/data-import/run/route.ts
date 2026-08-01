import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function POST() {
  try {
    const { dataImportService } = await createServices();
    const importRun = await dataImportService.runImport();
    return NextResponse.json({ importRun });
  } catch (error) {
    return toErrorResponse(error);
  }
}
