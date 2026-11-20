// Enquiry lifecycle rules (Phase B, Commerce Spine).
//
// The status column existed from the first schema but nothing could write it,
// so merchant inboxes accumulated OPEN rows forever. The rules are kept as a
// pure function so the matrix is testable without a database:
//   OPEN → RESOLVED   merchant only (the question was answered / deal done)
//   OPEN → CANCELLED  either participant (withdrawn; terminal for both)
//   RESOLVED → OPEN   either participant (the conversation reopens honestly)
//   CANCELLED → …     terminal: a withdrawn enquiry never auto-revives

export type EnquiryStatus = 'OPEN' | 'RESOLVED' | 'CANCELLED'

export function enquiryTransitionAllowed(from: EnquiryStatus, to: EnquiryStatus, isMerchant: boolean): boolean {
  if (from === 'OPEN' && to === 'RESOLVED') return isMerchant
  if (from === 'OPEN' && to === 'CANCELLED') return true
  if (from === 'RESOLVED' && to === 'OPEN') return true
  return false
}
