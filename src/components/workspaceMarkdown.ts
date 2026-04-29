function isExternalOrDataUrl(url: string) {
  return /^(?:https?:|data:|blob:|katopgpt-)/i.test(url)
}

export interface WorkspaceImageViewPayload {
  src: string
  alt: string
  title: string
  svg?: string
}

export function normalizeWorkspaceImageSource(rawSource: string | undefined) {
  const trimmed = rawSource?.trim() ?? ''
  if (!trimmed) return ''
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function buildWorkspaceImageUrl(workspaceRootPath: string | undefined, src: string | undefined) {
  if (!workspaceRootPath || !src || isExternalOrDataUrl(src) || src.startsWith('#')) return src
  return `katopgpt-workspace://asset?root=${encodeURIComponent(workspaceRootPath)}&path=${encodeURIComponent(src)}`
}

export function resolveWorkspaceImagePayload(
  workspaceRootPath: string | undefined,
  src: string | undefined,
  alt: string | undefined
): WorkspaceImageViewPayload | null {
  const normalizedSrc = normalizeWorkspaceImageSource(src)
  if (!normalizedSrc) return null

  return {
    src: buildWorkspaceImageUrl(workspaceRootPath, normalizedSrc) ?? normalizedSrc,
    alt: alt?.trim() || '图片',
    title: alt?.trim() || normalizedSrc || '图片',
  }
}
