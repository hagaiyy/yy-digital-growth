// Shared helpers for the local-development environment setup routes.
// This entire feature must never operate in production.

export function isLocalDevelopmentAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export const PRODUCTION_BLOCKED_MESSAGE =
  "Local environment setup is only available in development. Configure deployment secrets through your hosting environment instead.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Empirically, this Next.js dev server's own file watcher reloads
// .env.local into the live process's process.env within a few seconds
// of a change — no process restart needed (verified manually before
// building this feature, not assumed). This polls the *live* process
// for that reload rather than trying to force it, since there is no
// supported API to trigger Next's env reload on demand.
export async function waitForLiveEnvReload(
  varNames: string[],
  timeoutMs = 5000,
  pollIntervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (varNames.every((name) => Boolean(process.env[name]))) return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }
}
