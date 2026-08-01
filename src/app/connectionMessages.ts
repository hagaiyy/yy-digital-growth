// A just-attempted action's error is reset to "" (not undefined) at the
// start of every runAction call, so it must be combined with the
// persisted safeErrorMessage using `||`, not `??` — `??` only falls
// through on null/undefined, and treats "" as a real value, which
// silently rendered a blank message instead of the persisted one.
export function resolveDisplayedErrorMessage(
  actionErrorMessage: string | undefined,
  persistedSafeErrorMessage: string | undefined,
): string | undefined {
  return actionErrorMessage || persistedSafeErrorMessage;
}
