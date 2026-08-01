// Explicit, small configuration map for the local-development environment
// setup feature — deliberately not a generic settings framework. Every
// variable this feature can read the presence of or write a value for
// must be listed here; nothing else is ever accepted.

export type LocalSetupVariableName =
  | "APP_ENCRYPTION_KEY"
  | "INSTAGRAM_APP_ID"
  | "INSTAGRAM_APP_SECRET"
  | "INSTAGRAM_REDIRECT_URI"
  | "META_APP_ID"
  | "META_APP_SECRET"
  | "META_REDIRECT_URI"
  | "PINTEREST_APP_ID"
  | "PINTEREST_APP_SECRET"
  | "PINTEREST_REDIRECT_URI";

export type LocalSetupPlatform = "shared" | "instagram" | "facebook" | "pinterest";

export type LocalSetupVariableFormat = "encryptionKey" | "appId" | "secret" | "redirectUri";

export interface LocalSetupVariableDefinition {
  name: LocalSetupVariableName;
  label: string;
  platform: LocalSetupPlatform;
  secret: boolean;
  format: LocalSetupVariableFormat;
  description: string;
  defaultValue?: string;
  canGenerate: boolean;
}

export const LOCAL_SETUP_VARIABLES: LocalSetupVariableDefinition[] = [
  {
    name: "APP_ENCRYPTION_KEY",
    label: "Application Encryption Key",
    platform: "shared",
    secret: true,
    format: "encryptionKey",
    description:
      "Used to encrypt every stored platform credential. Required before any connection can be made. Generate one automatically, or paste your own 256-bit value.",
    canGenerate: true,
  },
  {
    name: "INSTAGRAM_APP_ID",
    label: "Instagram App ID",
    platform: "instagram",
    secret: false,
    format: "appId",
    description:
      "The Instagram App ID from your Meta app's Instagram API with Instagram Login product settings. Never the Facebook App ID.",
    canGenerate: false,
  },
  {
    name: "INSTAGRAM_APP_SECRET",
    label: "Instagram App Secret",
    platform: "instagram",
    secret: true,
    format: "secret",
    description:
      "The Instagram App Secret from your Meta app's Instagram API with Instagram Login product settings. Never the Facebook App Secret.",
    canGenerate: false,
  },
  {
    name: "META_APP_ID",
    label: "Meta App ID",
    platform: "facebook",
    secret: false,
    format: "appId",
    description: "The App ID of your Meta Developer app, used by the Facebook connection.",
    canGenerate: false,
  },
  {
    name: "META_APP_SECRET",
    label: "Meta App Secret",
    platform: "facebook",
    secret: true,
    format: "secret",
    description: "The App Secret of your Meta Developer app, used by the Facebook connection.",
    canGenerate: false,
  },
  {
    name: "INSTAGRAM_REDIRECT_URI",
    label: "Instagram Redirect URI",
    platform: "instagram",
    secret: false,
    format: "redirectUri",
    description: "The OAuth redirect URI registered for Instagram API with Instagram Login in your Meta app's settings.",
    defaultValue: "https://localhost:3000/api/connections/instagram/callback",
    canGenerate: false,
  },
  {
    name: "META_REDIRECT_URI",
    label: "Facebook Redirect URI",
    platform: "facebook",
    secret: false,
    format: "redirectUri",
    description: "The OAuth redirect URI registered for Facebook in your Meta app's settings.",
    defaultValue: "https://localhost:3000/api/connections/facebook/callback",
    canGenerate: false,
  },
  {
    name: "PINTEREST_APP_ID",
    label: "Pinterest App ID",
    platform: "pinterest",
    secret: false,
    format: "appId",
    description: "The App ID of your Pinterest Developer app.",
    canGenerate: false,
  },
  {
    name: "PINTEREST_APP_SECRET",
    label: "Pinterest App Secret",
    platform: "pinterest",
    secret: true,
    format: "secret",
    description: "The App Secret of your Pinterest Developer app.",
    canGenerate: false,
  },
  {
    name: "PINTEREST_REDIRECT_URI",
    label: "Pinterest Redirect URI",
    platform: "pinterest",
    secret: false,
    format: "redirectUri",
    description: "The OAuth redirect URI registered in your Pinterest Developer app's settings.",
    defaultValue: "https://localhost:3000/api/connections/pinterest/callback",
    canGenerate: false,
  },
];

export const LOCAL_SETUP_VARIABLE_NAMES: LocalSetupVariableName[] = LOCAL_SETUP_VARIABLES.map((v) => v.name);

export function getLocalSetupVariable(name: string): LocalSetupVariableDefinition | undefined {
  return LOCAL_SETUP_VARIABLES.find((v) => v.name === name);
}

export function isKnownLocalSetupVariable(name: string): name is LocalSetupVariableName {
  return getLocalSetupVariable(name) !== undefined;
}

// A conservative heuristic for values that were clearly never a real
// developer credential — e.g. "test-meta-app-id-123" written in while
// proving out this feature. Used both to reject a placeholder submitted
// through the setup modal and to stop the app from treating a
// placeholder already sitting in .env.local as valid configuration.
const PLACEHOLDER_VALUE_PATTERN = /^(test|placeholder|example|sample|dummy|fake|your|xxx+|changeme)[-_]/i;

export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (!value) return false;
  return PLACEHOLDER_VALUE_PATTERN.test(value.trim());
}

// The exact set of variables each Connect action needs — mirrors
// ConnectionService's own missingVarsFor() (connector-specific vars +
// APP_ENCRYPTION_KEY), duplicated here only for the UI's "should I show
// the setup modal instead of navigating" pre-check. The server remains
// the sole source of truth for whether a connection actually succeeds.
export const PLATFORM_REQUIRED_VARIABLES: Record<"instagram" | "facebook" | "pinterest", LocalSetupVariableName[]> = {
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI", "APP_ENCRYPTION_KEY"],
  facebook: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "APP_ENCRYPTION_KEY"],
  pinterest: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI", "APP_ENCRYPTION_KEY"],
};
