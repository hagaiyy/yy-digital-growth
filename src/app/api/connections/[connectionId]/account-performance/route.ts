import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

// Read-only — account-level insights (audience demographics, follower
// counts, profile-level activity) are stored separately from content
// performanceSnapshots (see AccountPerformanceSnapshot), so they need
// their own read path rather than reusing /api/imported-content.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    const { dataImportService } = await createServices();
    const snapshots = await dataImportService.getLatestAccountPerformance(connectionId);
    return NextResponse.json({ snapshots });
  } catch (error) {
    return toErrorResponse(error);
  }
}
