import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET() {
  try {
    const { performanceViewService } = await createServices();
    const tabs = await performanceViewService.listTabs();
    return NextResponse.json({ tabs });
  } catch (error) {
    return toErrorResponse(error);
  }
}
