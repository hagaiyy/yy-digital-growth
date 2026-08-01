import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import {
  dataImportSettingsSchema,
  importedContentSchema,
  importRunSchema,
  performanceSnapshotSchema,
  platformConnectionSchema,
} from "./schemas";
import type { PlatformConnection } from "@/domain/models/PlatformConnection";
import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import type { ImportRun } from "@/domain/models/ImportRun";
import type { DataImportSettings } from "@/domain/models/DataImportSettings";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validatePlatformConnectionSchema = ajv.compile(platformConnectionSchema);
const validateImportedContentSchema = ajv.compile(importedContentSchema);
const validatePerformanceSnapshotSchema = ajv.compile(performanceSnapshotSchema);
const validateImportRunSchema = ajv.compile(importRunSchema);
const validateDataImportSettingsSchema = ajv.compile(dataImportSettingsSchema);

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ErrorObject[] | null | undefined,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function validate<T>(
  validator: (candidate: unknown) => boolean,
  errors: () => ErrorObject[] | null | undefined,
  label: string,
  candidate: unknown,
): T {
  if (!validator(candidate)) {
    throw new ValidationError(`${label} failed schema validation`, errors());
  }
  return candidate as unknown as T;
}

export function validatePlatformConnection(candidate: unknown): PlatformConnection {
  return validate<PlatformConnection>(
    validatePlatformConnectionSchema,
    () => validatePlatformConnectionSchema.errors,
    "platformConnection",
    candidate,
  );
}

export function validateImportedContent(candidate: unknown): ImportedContent {
  return validate<ImportedContent>(
    validateImportedContentSchema,
    () => validateImportedContentSchema.errors,
    "importedContent",
    candidate,
  );
}

export function validatePerformanceSnapshot(candidate: unknown): PerformanceSnapshot {
  return validate<PerformanceSnapshot>(
    validatePerformanceSnapshotSchema,
    () => validatePerformanceSnapshotSchema.errors,
    "performanceSnapshot",
    candidate,
  );
}

export function validateImportRun(candidate: unknown): ImportRun {
  return validate<ImportRun>(
    validateImportRunSchema,
    () => validateImportRunSchema.errors,
    "importRun",
    candidate,
  );
}

export function validateDataImportSettings(candidate: unknown): DataImportSettings {
  return validate<DataImportSettings>(
    validateDataImportSettingsSchema,
    () => validateDataImportSettingsSchema.errors,
    "dataImportSettings",
    candidate,
  );
}
