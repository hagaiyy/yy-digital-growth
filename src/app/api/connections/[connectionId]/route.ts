import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    const { connectionService } = await createServices();
    const connection = await connectionService.getConnection(connectionId);
    if (!connection) {
      return NextResponse.json(
        { error: { code: "notFound", message: "No such connection." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ connection });
  } catch (error) {
    return toErrorResponse(error);
  }
}
