import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { CONNECTION_IDS } from "@/domain/connectionIds";
import { toErrorResponse } from "@/interfaces/http/errors";

// TEMPORARY — isolates exactly which Page-posts discovery field is
// causing the live OAuthException code=12 seen after adding
// status_type/type to Stage A. Uses the real stored Page token. Never
// returns a token, secret, or raw provider message — only safe
// type/code/subcode per field. Remove once the root cause is fixed and
// proven live.
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const CANDIDATE_FIELDS = [
  "id,created_time",
  "id,created_time,message",
  "id,created_time,permalink_url",
  "id,created_time,attachments{type,media_type}",
  "id,created_time,full_picture",
  "id,created_time,status_type",
  "id,created_time,type",
];

interface SafeMetaError {
  type: string | null;
  code: number | null;
  subcode: number | null;
}

async function testFields(pageId: string, pageAccessToken: string, fields: string) {
  const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", pageAccessToken);

  try {
    const response = await fetch(url, { method: "GET" });
    if (response.ok) {
      return { fields, outcome: "supported" as const };
    }
    let error: SafeMetaError | null = null;
    try {
      const body = (await response.json()) as { error?: { type?: string; code?: number; error_subcode?: number } };
      if (body.error) {
        error = { type: body.error.type ?? null, code: body.error.code ?? null, subcode: body.error.error_subcode ?? null };
      }
    } catch {
      // ignore parse errors, error stays null
    }
    return { fields, outcome: "rejected" as const, httpStatus: response.status, error };
  } catch {
    return { fields, outcome: "networkError" as const };
  }
}

export async function GET() {
  try {
    const { connectionService } = await createServices();
    const pageConnection = await connectionService.getConnection(CONNECTION_IDS.facebookPage);
    if (!pageConnection || pageConnection.status !== "connected" || !pageConnection.externalAccountId) {
      return NextResponse.json({ error: { code: "notConnected", message: "Facebook Page is not connected." } }, { status: 400 });
    }
    const credential = await connectionService.getDecryptedCredential(CONNECTION_IDS.facebookPage);
    if (!credential) {
      return NextResponse.json({ error: { code: "notConnected", message: "Facebook Page credential unavailable." } }, { status: 400 });
    }
    const pageAccessToken = credential.accessToken as string;
    const pageId = pageConnection.externalAccountId;

    const results = [];
    for (const fields of CANDIDATE_FIELDS) {
      results.push(await testFields(pageId, pageAccessToken, fields));
    }

    return NextResponse.json({ results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
