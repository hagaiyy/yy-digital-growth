import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Safe, minimal .env-file updater for the local-setup feature only.
// Never logs or returns file contents anywhere in this module.

const KEY_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/;

// A double-quoted value is the least ambiguous form for dotenv-style
// parsers (handles '#', spaces, and '=' inside the value without being
// misread as a comment or a second assignment); backslashes and quotes
// inside the value are escaped so the file always parses back to
// exactly the original string.
function quoteValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// Serializes concurrent calls onto one queue so two simultaneous save
// requests can never interleave their reads/writes of the same file.
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  // Swallow rejections here so one failed write doesn't wedge the queue
  // for subsequent, unrelated writes — callers still see their own
  // rejection via the returned `result` promise.
  writeQueue = result.catch(() => undefined);
  return result;
}

function unquoteValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return raw;
}

export interface UpdateEnvFileResult {
  updatedKeys: string[];
  createdKeys: string[];
}

// Requirements (see the task that introduced this module):
// preserve unrelated lines and comments, update an existing KEY= line in
// place rather than duplicating it, add missing keys on new lines,
// tolerate a missing trailing newline, back up the previous file
// content first, and write through a temp file + atomic rename.
export async function updateEnvFile(
  filePath: string,
  updates: Record<string, string>,
): Promise<UpdateEnvFileResult> {
  return enqueue(async () => {
    const original = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

    if (original.length > 0) {
      writeFileSync(`${filePath}.backup`, original, { encoding: "utf8", mode: 0o600 });
    }

    // Splitting on "\n" (rather than appending raw text) is what
    // guarantees a new variable can never be glued onto the end of the
    // previous line when the file is missing its final newline.
    const lines = original.length > 0 ? original.split("\n") : [];
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    const updatedKeys: string[] = [];
    const remaining = new Map(Object.entries(updates));

    const rewritten = lines.map((line) => {
      const match = line.match(KEY_LINE_PATTERN);
      const key = match?.[1];
      if (key && remaining.has(key)) {
        const value = remaining.get(key)!;
        remaining.delete(key);
        updatedKeys.push(key);
        return `${key}=${quoteValue(value)}`;
      }
      return line;
    });

    const createdKeys: string[] = [];
    for (const [key, value] of remaining) {
      rewritten.push(`${key}=${quoteValue(value)}`);
      createdKeys.push(key);
    }

    const finalContent = rewritten.length > 0 ? `${rewritten.join("\n")}\n` : "";

    const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(tmpPath, finalContent, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);

    // Confirm after writing that each requested variable exists and is
    // non-empty, without ever holding onto or logging the values.
    const verifyContent = readFileSync(filePath, "utf8");
    for (const key of Object.keys(updates)) {
      const lineMatch = verifyContent
        .split("\n")
        .find((line) => line.startsWith(`${key}=`));
      const valuePart = lineMatch?.slice(key.length + 1) ?? "";
      if (valuePart.replace(/^"|"$/g, "").length === 0) {
        throw new Error(`Failed to persist a non-empty value for ${key}.`);
      }
    }

    return { updatedKeys, createdKeys };
  });
}

export interface RemoveEnvKeysResult {
  removedKeys: string[];
}

// Removes only the KEY= lines whose current (unquoted) value satisfies
// `shouldRemove` — every other line, including comments, unrelated
// variables, and keys the predicate declines to remove, is left exactly
// as-is. Shares the same write queue, backup, and atomic-rename
// guarantees as updateEnvFile so a removal can never interleave with a
// concurrent save of the same file.
export async function removeEnvKeys(
  filePath: string,
  shouldRemove: (key: string, value: string) => boolean,
): Promise<RemoveEnvKeysResult> {
  return enqueue(async () => {
    const original = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    if (original.length === 0) return { removedKeys: [] };

    const lines = original.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    const removedKeys: string[] = [];
    const kept = lines.filter((line) => {
      const match = line.match(KEY_LINE_PATTERN);
      const key = match?.[1];
      if (!key) return true;
      const rawValue = line.slice(key.length + 1);
      if (shouldRemove(key, unquoteValue(rawValue))) {
        removedKeys.push(key);
        return false;
      }
      return true;
    });

    if (removedKeys.length === 0) return { removedKeys: [] };

    writeFileSync(`${filePath}.backup`, original, { encoding: "utf8", mode: 0o600 });

    const finalContent = kept.length > 0 ? `${kept.join("\n")}\n` : "";
    const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(tmpPath, finalContent, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);

    return { removedKeys };
  });
}
