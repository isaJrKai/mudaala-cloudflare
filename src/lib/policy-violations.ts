// Pure policy threshold helper. Counts passed here must already exclude
// overturned decisions and must never include raw reports or automatic hides.
export function shouldSendFormalPolicyWarning(activeConfirmedViolationCount: number): boolean {
  return Number.isInteger(activeConfirmedViolationCount) && activeConfirmedViolationCount >= 4
}
