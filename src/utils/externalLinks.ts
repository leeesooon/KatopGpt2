const HTML_AMPERSAND_RE = /&(?:amp(?:;|%3[Bb])|#38;)/gi
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function normalizeExternalUrl(rawUrl?: string | null) {
  if (!rawUrl) return null

  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null

  const normalizedUrl = trimmedUrl.replace(HTML_AMPERSAND_RE, '&')

  try {
    const url = new URL(normalizedUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function openExternalUrl(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) return false

  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(externalUrl)
    return true
  }

  window.open(externalUrl, '_blank', 'noopener,noreferrer')
  return true
}
