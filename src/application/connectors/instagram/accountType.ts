// Meta's own account_type values (from GET /me?fields=account_type),
// normalized to the three real account kinds the Instagram Graph API
// distinguishes. Only Business/Creator professional accounts can even
// complete this app's OAuth flow — "personal" is kept only so an
// unexpected raw value never silently becomes "business".
export type NormalizedInstagramAccountType = "business" | "creator" | "personal" | "unknown";

export function normalizeInstagramAccountType(raw: string | undefined): NormalizedInstagramAccountType {
  const upper = raw?.toUpperCase();
  if (upper === "BUSINESS") return "business";
  if (upper === "MEDIA_CREATOR" || upper === "CREATOR") return "creator";
  if (upper === "PERSONAL") return "personal";
  return "unknown";
}
