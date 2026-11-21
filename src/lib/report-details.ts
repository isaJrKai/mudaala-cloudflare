// Report details are capped at 500 characters by the API. A report can carry a
// short context note (e.g. "from a tap-to-shop tag") that moderators see first;
// this keeps the note + the reporter's own words inside the cap, so the
// reporter's text is trimmed, never the note, and never silently rejected.

export const REPORT_DETAILS_MAX = 500

export function reportDetailsRoom(contextNote?: string): number {
  return contextNote ? REPORT_DETAILS_MAX - contextNote.length - 1 : REPORT_DETAILS_MAX
}

export function composeReportDetails(details: string, contextNote?: string): string | null {
  const own = details.trim().slice(0, reportDetailsRoom(contextNote))
  const text = contextNote ? (own ? `${contextNote} ${own}` : contextNote) : own
  return text || null
}
