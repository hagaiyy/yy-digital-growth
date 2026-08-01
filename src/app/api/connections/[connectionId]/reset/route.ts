import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    const { connectionService } = await createServices();
    const connection = await connectionService.resetConnectionAttempt(connectionId);
    return NextResponse.json({ connection });
  } catch (error) {
    return toErrorResponse(error);
  }
}
