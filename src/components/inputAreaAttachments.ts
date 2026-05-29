export const FILE_INPUT_ACCEPT = '.txt,.md,.markdown,.json,.csv,.pdf,.pptx,.docx,.xlsx'

export const MAX_FILES_PER_BATCH = 10
export const MAX_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENT_CONTEXT_CHARS = 30000
export const MAX_ATTACHMENT_PREVIEW_CHARS = 4000

const TEXT_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.json']

const EXTRACTABLE_DOCUMENT_EXTENSIONS = ['.pptx', '.pdf', '.docx', '.xlsx', '.csv']

const EXTRACTABLE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]

export function looksLikeBinaryText(content: string) {
  if (!content) return false

  const sample = content.slice(0, 4000)
  let suspiciousChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    const isAllowedControl = code === 9 || code === 10 || code === 13
    const isSuspiciousControl = code === 0 || (code < 32 && !isAllowedControl)
    if (isSuspiciousControl || char === '\u0000' || char === '\u001a' || char === '\u0003') {
      suspiciousChars += 1
    }
  }

  return suspiciousChars > Math.max(8, sample.length * 0.02)
}

export function getFileExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex).toLowerCase() : ''
}

export function isExtractableDocument(file: File) {
  const extension = getFileExtension(file.name)
  if (EXTRACTABLE_DOCUMENT_EXTENSIONS.includes(extension)) {
    return true
  }

  return EXTRACTABLE_DOCUMENT_MIME_TYPES.includes(file.type)
}

export function isTextAttachment(file: File) {
  const extension = getFileExtension(file.name)
  return TEXT_FILE_EXTENSIONS.includes(extension) || file.type.startsWith('text/')
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1048576).toFixed(1)} MB`
}

export function validateAttachmentBatch(incomingFiles: File[], currentCount: number) {
  if (incomingFiles.length === 0) return null
  if (incomingFiles.length > MAX_FILES_PER_BATCH) {
    return `单次最多添加 ${MAX_FILES_PER_BATCH} 个文件，请分批上传。`
  }
  if (currentCount + incomingFiles.length > MAX_FILES_PER_BATCH) {
    return `当前对话框最多保留 ${MAX_FILES_PER_BATCH} 个附件，请先删除部分附件。`
  }
  return null
}

export function validateAttachmentFile(file: File) {
  if (file.size === 0) {
    return '文件为空，无法上传。'
  }

  if (file.type.startsWith('image/')) {
    return file.size > MAX_IMAGE_FILE_BYTES
      ? `图片过大，单张图片上限为 ${formatFileSize(MAX_IMAGE_FILE_BYTES)}。`
      : null
  }

  if (isExtractableDocument(file)) {
    return file.size > MAX_DOCUMENT_FILE_BYTES
      ? `文档过大，自动提取上限为 ${formatFileSize(MAX_DOCUMENT_FILE_BYTES)}。`
      : null
  }

  if (isTextAttachment(file)) {
    return file.size > MAX_TEXT_FILE_BYTES
      ? `文本文件过大，单个纯文本上限为 ${formatFileSize(MAX_TEXT_FILE_BYTES)}。`
      : null
  }

  return '暂不支持该文件类型，请上传文本、图片、PDF、PPTX、DOCX、XLSX 或 CSV 文件。'
}

export function buildAttachmentContentFields(content: string) {
  const originalContentLength = content.length
  const isTruncated = originalContentLength > MAX_ATTACHMENT_CONTEXT_CHARS
  const contextContent = isTruncated
    ? `${content.slice(0, MAX_ATTACHMENT_CONTEXT_CHARS).trimEnd()}\n\n[已截断，原始内容 ${originalContentLength} 字符，仅保留前 ${MAX_ATTACHMENT_CONTEXT_CHARS} 字符作为上下文]`
    : content
  const previewContent = originalContentLength > MAX_ATTACHMENT_PREVIEW_CHARS
    ? `${content.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS).trimEnd()}\n\n[预览已截断]`
    : content

  return {
    originalContentLength,
    isTruncated,
    previewContent,
    contextContent,
    validationWarning: isTruncated
      ? `内容较长，已压缩为前 ${MAX_ATTACHMENT_CONTEXT_CHARS} 字符参与对话。`
      : undefined,
  }
}

export {
  DEFAULT_IMAGE_PROMPT_MODULES,
  createDefaultImagePromptModules,
  normalizeImagePromptModules,
} from '../types'
