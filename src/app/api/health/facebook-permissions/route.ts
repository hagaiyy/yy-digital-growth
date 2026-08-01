import { NextResponse } from "next/server";

import { createServices } from "@/application/services";
import { CONNECTION_IDS } from "@/domain/connectionIds";

// Temporary production-safe diagnostic for the Facebook Page import
// failure (OAuthException code=10). Uses the existing encrypted Facebook
// credentials server-side to inspect real, live token/permission state
// via Meta's own token-debug and permissions mechanisms — never guesses.
//
// This route is read-only: it never writes to a connection or
// credential record, and it makes exactly the same *kind* of read
// request DataImportService already makes (a minimal, non-engagement
// /{pageId}/posts read) — it does not change Data Import behavior.
//
// Never returned or logged, anywhere in this file: the user access
// token, the Page access token, the app secret, account/page names, or
// any raw Meta API response body.

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

type Stage = "configuration" | "connection" | "tokenDebug" | "postsCheck" | "unknown";

const REQUIRED_PERMISSIONS = ["public_profile", "pages_show_list", "pages_read_engagement"] as const;

interface DebugTokenData {
  app_id?: string;
  type?: string;
  is_valid?: boolean;
  expires_at?: number;
  profile_id?: string;
  scopes?: string[];
}

interface MetaErrorShape {
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

function errorResponse(stage: Stage) {
  return NextResponse.json({ status: "error", stage }, { status: 503 });
}

async function debugToken(
  token: string,
  appId: string,
  appSecret: string,
): Promise<{ data: DebugTokenData } | null> {
  const url = new URL(`${GRAPH_API_BASE}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return null;
    return (await response.json()) as { data: DebugTokenData };
  } catch {
    return null;
  }
}

async function fetchGrantedAndDeclined(
  userAccessToken: string,
): Promise<{ granted: string[]; declined: string[] } | null> {
  const url = new URL(`${GRAPH_API_BASE}/me/permissions`);
  url.searchParams.set("access_token", userAccessToken);
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Array<{ permission?: string; status?: string }> };
    const granted: string[] = [];
    const declined: string[] = [];
    for (const entry of body.data ?? []) {
      if (!entry.permission) continue;
      if (entry.status === "granted") granted.push(entry.permission);
      else if (entry.status === "declined") declined.push(entry.permission);
    }
    return { granted, declined };
  } catch {
    return null;
  }
}

async function minimalPostsCheck(
  pageId: string,
  pageAccessToken: string,
): Promise<{ ok: true } | { ok: false; error: MetaErrorShape | null }> {
  const url = new URL(`${GRAPH_API_BASE}/${pageId}/posts`);
  // Deliberately minimal — no engagement, insights, or reactions fields —
  // to isolate whether the rejection is caused by the /posts edge itself
  // or by one of the additional fields the real import path requests.
  url.searchParams.set("fields", "id,created_time");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", pageAccessToken);
  try {
    const response = await fetch(url, { method: "GET" });
    if (response.ok) return { ok: true };
    let error: MetaErrorShape | null = null;
    try {
      const body = (await response.json()) as { error?: MetaErrorShape };
      error = body.error ?? null;
    } catch {
      error = null;
    }
    return { ok: false, error };
  } catch {
    return { ok: false, error: null };
  }
}

export async function GET() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return errorResponse("configuration");
  }

  const { connectionService } = await createServices();

  const [accountConnection, pageConnection] = await Promise.all([
    connectionService.getConnection(CONNECTION_IDS.facebookAccount),
    connectionService.getConnection(CONNECTION_IDS.facebookPage),
  ]);
  if (
    !accountConnection ||
    accountConnection.status !== "connected" ||
    !pageConnection ||
    pageConnection.status !== "connected" ||
    !pageConnection.externalAccountId
  ) {
    return errorResponse("connection");
  }
  const pageId = pageConnection.externalAccountId;

  const [userCredential, pageCredential] = await Promise.all([
    connectionService.getDecryptedCredential(CONNECTION_IDS.facebookAccount),
    connectionService.getDecryptedCredential(CONNECTION_IDS.facebookPage),
  ]);
  if (!userCredential || !pageCredential) {
    return errorResponse("connection");
  }
  const userAccessToken = userCredential.accessToken as string;
  const pageAccessToken = pageCredential.accessToken as string;

  const [userDebug, pageDebug, permissions] = await Promise.all([
    debugToken(userAccessToken, appId, appSecret),
    debugToken(pageAccessToken, appId, appSecret),
    fetchGrantedAndDeclined(userAccessToken),
  ]);
  if (!userDebug || !pageDebug) {
    return errorResponse("tokenDebug");
  }

  const userData = userDebug.data;
  const pageData = pageDebug.data;

  const userTokenValid = userData.is_valid === true;
  const userTokenAppIdMatches = userData.app_id === appId;
  const userTokenExpiresAt =
    typeof userData.expires_at === "number" && userData.expires_at > 0
      ? new Date(userData.expires_at * 1000).toISOString()
      : null;

  const pageTokenValid = pageData.is_valid === true;
  const pageIdMatches = pageData.profile_id === pageId;

  // Prefer /me/permissions (the authoritative granted/declined source);
  // fall back to the user token's own debug_token scopes if that call
  // failed for any reason, so a single failed sub-request doesn't blank
  // out the whole report.
  const grantedPermissions = permissions?.granted ?? userData.scopes ?? [];
  const declinedPermissions = permissions?.declined ?? [];
  const missingPermissions = REQUIRED_PERMISSIONS.filter((p) => !grantedPermissions.includes(p));
  const pageTokenGrantedPermissions = pageData.scopes ?? [];

  const postsResult = await minimalPostsCheck(pageId, pageAccessToken);

  const status =
    userTokenValid && pageTokenValid && pageIdMatches && missingPermissions.length === 0 && postsResult.ok
      ? "ok"
      : "error";

  return NextResponse.json({
    status,
    userTokenValid,
    userTokenAppIdMatches,
    userTokenType: userData.type ?? null,
    userTokenExpiresAt,
    pageTokenValid,
    pageIdMatches,
    pageTokenType: pageData.type ?? null,
    grantedPermissions,
    missingPermissions,
    declinedPermissions,
    pageTokenGrantedPermissions,
    postsCheck: postsResult.ok ? "ok" : "failed",
    postsCheckError: postsResult.ok
      ? null
      : postsResult.error
        ? {
            type: postsResult.error.type ?? null,
            code: postsResult.error.code ?? null,
            subcode: postsResult.error.error_subcode ?? null,
            fbtraceId: postsResult.error.fbtrace_id ?? null,
          }
        : null,
  });
}
