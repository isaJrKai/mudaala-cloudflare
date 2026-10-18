/**
 * Uploaded photos use random immutable object names. Their feed rendition is
 * stored beside the original as <stem>.thumb.webp. Seed/legacy URLs keep using
 * the original until a thumbnail exists; ListingPhoto handles that fallback.
 */
export function listingThumbnailUrl(originalUrl: string): string {
  try {
    const parsed = new URL(originalUrl, 'https://mudaala.invalid')
    const match = parsed.pathname.match(/^(.*\/)?([0-9a-f]{8}-[0-9a-f]{16})\.(?:jpg|jpeg|png|webp)$/i)
    if (!match) return originalUrl
    parsed.pathname = `${match[1] ?? ''}${match[2]}.thumb.webp`
    return /^https?:\/\//i.test(originalUrl)
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return originalUrl
  }
}
