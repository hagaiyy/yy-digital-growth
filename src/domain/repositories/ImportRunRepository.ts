import type { ImportRun } from "@/domain/models/ImportRun";

// Thrown by createRunning() when another importRun already has
// status "running" — mirrors MongoDB's partial unique index on
// { status: "running" }, which is the actual source of truth for this
// guarantee in the real repository.
export class RunningImportConflictError extends Error {
  constructor() {
    super("An import is already running.");
    this.name = "RunningImportConflictError";
  }
}

export interface ImportRunRepository {
  /** Atomically creates a new running run, or throws RunningImportConflictError. */
  createRunning(run: ImportRun): Promise<ImportRun>;
  save(run: ImportRun): Promise<ImportRun>;
  findLatest(): Promise<ImportRun | null>;
  findById(importRunId: string): Promise<ImportRun | null>;
  findRunning(): Promise<ImportRun | null>;
}
