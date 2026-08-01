import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  platform: string;
  nonce: string;
  iat: number;
  exp: number;
}

function sign(payloadBase64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

// Stateless, signed, expiring OAuth state: no server-side storage or
// cookie is required because the state token itself carries an
// HMAC-SHA256 signature keyed by APP_ENCRYPTION_KEY. Anyone without that
// secret cannot forge a valid state, so this also doubles as CSRF
// protection for the OAuth redirect.
export function generateOAuthState(platform: string, secret: string): string {
  const payload: StatePayload = {
    platform,
    nonce: randomBytes(16).toString("hex"),
    iat: Date.now(),
    exp: Date.now() + STATE_TTL_MS,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(payloadBase64, secret);
  return `${payloadBase64}.${signature}`;
}

export function verifyOAuthState(
  state: string | null | undefined,
  expectedPlatform: string,
  secret: string,
): boolean {
  if (!state) return false;
  const separatorIndex = state.lastIndexOf(".");
  if (separatorIndex === -1) return false;

  const payloadBase64 = state.slice(0, separatorIndex);
  const signature = state.slice(separatorIndex + 1);
  const expectedSignature = sign(payloadBase64, secret);

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return false;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return false;
  }

  if (payload.platform !== expectedPlatform) return false;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;

  return true;
}
