import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  LOCAL_SETUP_VARIABLES,
  getLocalSetupVariable,
  isPlaceholderValue,
  type LocalSetupVariableDefinition,
} from "@/config/localSetupVariables";
import { updateEnvFile } from "@/infrastructure/localEnv/envFileWriter";
import { waitForLiveEnvReload } from "@/interfaces/http/localSetup";
import { SafeServiceError } from "@/application/services/ConnectionService";

export interface EnvironmentVariableStatus {
  name: string;
  configured: boolean;
  platform: string;
  secret: boolean;
}

export interface SaveEnvironmentResult {
  savedVariableNames: string[];
  restartRequired: boolean;
}

function assertNoNewline(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new SafeServiceError("invalidValue", `${name} must not contain a newline.`);
  }
}

function validateValue(def: LocalSetupVariableDefinition, rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    throw new SafeServiceError("invalidValue", `${def.name} must be a text value.`);
  }
  if (rawValue.length === 0) {
    throw new SafeServiceError("emptyValue", `${def.name} must not be empty.`);
  }
  assertNoNewline(def.name, rawValue);
  if (rawValue.length > 4096) {
    throw new SafeServiceError("invalidValue", `${def.name} is too long.`);
  }
  if (isPlaceholderValue(rawValue)) {
    throw new SafeServiceError(
      "placeholderValue",
      `${def.name} looks like a placeholder or test value, not a real credential. Enter your actual developer application value.`,
    );
  }

  if (def.format === "redirectUri") {
    let url: URL;
    try {
      url = new URL(rawValue);
    } catch {
      throw new SafeServiceError("invalidValue", `${def.name} must be a valid URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SafeServiceError("invalidValue", `${def.name} must use http or https.`);
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new SafeServiceError(
        "invalidValue",
        `${def.name} must point at localhost — this setup form is for local development only.`,
      );
    }
  } else if (def.format === "appId") {
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(rawValue)) {
      throw new SafeServiceError("invalidValue", `${def.name} does not look like a valid application ID.`);
    }
  }
  // "secret" and "encryptionKey" formats accept any non-empty,
  // single-line, reasonably-sized value — their exact shape varies by
  // provider and is not ours to second-guess.

  return rawValue;
}

export class LocalSetupService {
  private readonly envFilePath: string;
  private readonly liveReloadTimeoutMs: number;

  constructor(options?: { envFilePath?: string; liveReloadTimeoutMs?: number }) {
    this.envFilePath = options?.envFilePath ?? path.join(process.cwd(), ".env.local");
    this.liveReloadTimeoutMs = options?.liveReloadTimeoutMs ?? 5000;
  }

  getEnvironmentStatus(): EnvironmentVariableStatus[] {
    return LOCAL_SETUP_VARIABLES.map((def) => {
      const value = process.env[def.name];
      return {
        name: def.name,
        configured: Boolean(value) && !isPlaceholderValue(value),
        platform: def.platform,
        secret: def.secret,
      };
    });
  }

  private validateSubmittedValues(values: Record<string, unknown>): Record<string, string> {
    const entries = Object.entries(values ?? {});
    if (entries.length === 0) {
      throw new SafeServiceError("emptyRequest", "No configuration values were submitted.");
    }
    const validated: Record<string, string> = {};
    for (const [name, rawValue] of entries) {
      const def = getLocalSetupVariable(name);
      if (!def) {
        throw new SafeServiceError("unknownVariable", `Unknown environment variable: ${name}.`);
      }
      validated[name] = validateValue(def, rawValue);
    }
    return validated;
  }

  async saveEnvironmentValues(values: Record<string, unknown>): Promise<SaveEnvironmentResult> {
    const validated = this.validateSubmittedValues(values);
    await updateEnvFile(this.envFilePath, validated);
    const liveReloadDetected = await waitForLiveEnvReload(Object.keys(validated), this.liveReloadTimeoutMs);
    return { savedVariableNames: Object.keys(validated), restartRequired: !liveReloadDetected };
  }

  async generateEncryptionKey(): Promise<SaveEnvironmentResult> {
    const key = randomBytes(32).toString("base64");
    await updateEnvFile(this.envFilePath, { APP_ENCRYPTION_KEY: key });
    const liveReloadDetected = await waitForLiveEnvReload(["APP_ENCRYPTION_KEY"], this.liveReloadTimeoutMs);
    return { savedVariableNames: ["APP_ENCRYPTION_KEY"], restartRequired: !liveReloadDetected };
  }
}
