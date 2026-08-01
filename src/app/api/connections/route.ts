import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

export async function GET() {
  try {
    const { connectionService } = await createServices();
    const connections = await connectionService.list();
    return NextResponse.json({ connections });
  } catch (error) {
    return toErrorResponse(error);
  }
}
