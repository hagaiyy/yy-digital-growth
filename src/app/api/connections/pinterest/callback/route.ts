import { NextResponse } from "next/server";

import { createServices } from "@/application/services";

function baseUrl(request: Request): string {
  return process.env.APP_BASE_URL ?? new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  try {
    const { connectionService } = await createServices();
    const { success } = await connectionService.handlePinterestCallback(code, state);
    return NextResponse.redirect(
      `${baseUrl(request)}/?connection=pinterest&result=${success ? "success" : "failed"}`,
    );
  } catch {
    return NextResponse.redirect(`${baseUrl(request)}/?connection=pinterest&result=failed`);
  }
}
