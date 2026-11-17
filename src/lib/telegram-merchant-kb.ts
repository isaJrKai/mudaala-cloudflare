import { merchantKb, renderReply } from '@/lib/merchant-kb'

const matcher = merchantKb()

/** Returns a verified local answer, or null to allow the AI fallback. */
export function merchantKnowledgeAnswer(message: string): string | null {
  const result = matcher.match(message)
  if (result.kind === 'no_match') return null
  return renderReply(result).text
}
