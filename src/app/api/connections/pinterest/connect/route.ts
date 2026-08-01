import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { toErrorResponse } from "@/interfaces/http/errors";

function baseUrl(request: Request): string {
  return process.env.APP_BASE_URL ?? new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const { connectionService } = await createServices();
    const { redirectUrl } = await connectionService.startPinterestConnect();
    if (!redirectUrl) {
      return NextResponse.redirect(`${baseUrl(request)}/?connection=pinterest&result=setupRequired`);
    }
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    return toErrorResponse(error);
  }
}
