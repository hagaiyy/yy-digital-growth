import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function POST() {
  try {
    const { connectionService } = await createServices();
    const connection = await connectionService.disconnectPinterest();
    return NextResponse.json({ connection });
  } catch (error) {
    return toErrorResponse(error);
  }
}
