import JSZip from 'jszip'

export interface ExtractDocumentTextRequest {
  fileName: string
  mimeType?: string
  data: ArrayBuffer
}

export interface ExtractDocumentTextResult {
  ok: boolean
  content?: string
  error?: string
  fileType?: 'pptx' | 'pdf' | 'docx'
}

type SupportedDocumentType = 'pptx' | 'pdf' | 'docx'

const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_SECTION_COUNT = 8
const MAX_SECTION_CHARS = 700
const MAX_SUMMARY_CHARS = 6000

type PdfWorkerModule = {
  WorkerMessageHandler?: unknown
}

type GlobalWithPdfWorker = typeof globalThis & {
  pdfjsWorker?: PdfWorkerModule
}

function getSupportedDocumentType(fileName: string, mimeType?: string): SupportedDocumentType | null {
  const lowerName = fileName.trim().toLowerCase()
  const lowerMimeType = mimeType?.trim().toLowerCase()

  if (
    lowerName.endsWith('.pptx') ||
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'pptx'
  }

  if (lowerName.endsWith('.pdf') || lowerMimeType === 'application/pdf') {
    return 'pdf'
  }

  if (
    lowerName.endsWith('.docx') ||
    lowerMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }

  return null
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text

  const shortened = text.slice(0, maxChars)
  const breakIndex = Math.max(
    shortened.lastIndexOf('\n'),
    shortened.lastIndexOf('。'),
    shortened.lastIndexOf('！'),
    shortened.lastIndexOf('？'),
    shortened.lastIndexOf(' ')
  )

  const safeIndex = breakIndex > maxChars * 0.6 ? breakIndex : maxChars
  return `${shortened.slice(0, safeIndex).trimEnd()}...`
}

function pickRepresentativeSections(sections: string[], maxCount: number) {
  if (sections.length <= maxCount) {
    return sections.map((text, index) => ({ index, text }))
  }

  const indexes = new Set<number>()
  for (let i = 0; i < maxCount; i += 1) {
    indexes.add(Math.round((i * (sections.length - 1)) / (maxCount - 1)))
  }

  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => ({ index, text: sections[index] }))
}

function buildSummary(
  fileTypeLabel: string,
  sections: string[],
  sectionLabel: string,
  renderSectionTitle: (index: number) => string
) {
  const cleanedSections = sections
    .map((section) => truncateText(normalizeWhitespace(section), MAX_SECTION_CHARS))
    .filter(Boolean)

  if (cleanedSections.length === 0) {
    throw new Error('未提取到可用文本')
  }

  const selectedSections = pickRepresentativeSections(cleanedSections, MAX_SECTION_COUNT)
  const parts = [
    `[自动提取摘要 | ${fileTypeLabel}]`,
    `说明：已自动提取可读文本并压缩为摘要，可能省略图片、版式、表格样式和部分重复内容。`,
    `总${sectionLabel}数：${cleanedSections.length}`,
  ]

  for (const section of selectedSections) {
    parts.push(`${renderSectionTitle(section.index)}\n${section.text}`)
  }

  if (cleanedSections.length > selectedSections.length) {
    parts.push(`其余内容已省略。`)
  }

  return truncateText(parts.join('\n\n'), MAX_SUMMARY_CHARS)
}

function extractXmlText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/\s*>/gi, '\t')
      .replace(/<(?:w:br|a:br)\b[^>]*\/\s*>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n\n')
      .replace(/<\/a:p>/gi, '\n\n')
      .replace(/<\/w:tr>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
}

function splitIntoBlocks(text: string) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean)
}

function sortNumberedXmlPaths(paths: string[]) {
  return [...paths].sort((left, right) => {
    const leftNumber = Number(left.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0)
    const rightNumber = Number(right.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0)
    return leftNumber - rightNumber
  })
}

async function extractDocxSummary(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docPaths = [
    'word/document.xml',
    'word/footnotes.xml',
    'word/endnotes.xml',
  ].filter((path) => zip.file(path))

  const blocks: string[] = []
  for (const path of docPaths) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    blocks.push(...splitIntoBlocks(extractXmlText(xml)))
  }

  return buildSummary('DOCX', blocks, '片段', (index) => `[片段 ${index + 1}]`)
}

async function extractPptxSummary(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const slidePaths = sortNumberedXmlPaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
  )

  const slides: string[] = []
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    const slideText = normalizeWhitespace(extractXmlText(xml))
    if (slideText) {
      slides.push(slideText)
    }
  }

  return buildSummary('PPTX', slides, '页', (index) => `[第 ${index + 1} 页]`)
}

async function extractPdfSummary(buffer: Buffer) {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])

  ;(globalThis as GlobalWithPdfWorker).pdfjsWorker = workerModule as PdfWorkerModule
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
  } as Record<string, unknown>)

  try {
    const document = await loadingTask.promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = normalizeWhitespace(
        (content.items as Array<{ str?: string; hasEOL?: boolean }>)
          .map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`)
          .join('')
      )

      if (pageText) {
        pages.push(pageText)
      }

      page.cleanup()
    }

    return buildSummary('PDF', pages, '页', (index) => `[第 ${index + 1} 页]`)
  } finally {
    await loadingTask.destroy()
  }
}

export async function extractDocumentText(
  request: ExtractDocumentTextRequest
): Promise<ExtractDocumentTextResult> {
  const fileType = getSupportedDocumentType(request.fileName, request.mimeType)
  if (!fileType) {
    return {
      ok: false,
      error: '暂不支持自动提取该文件类型',
    }
  }

  const buffer = Buffer.from(request.data)
  if (buffer.byteLength === 0) {
    return {
      ok: false,
      fileType,
      error: '文件为空，无法提取文本',
    }
  }

  if (buffer.byteLength > MAX_INPUT_BYTES) {
    return {
      ok: false,
      fileType,
      error: '文件过大，暂不支持自动提取（上限 20 MB）',
    }
  }

  try {
    const content =
      fileType === 'docx'
        ? await extractDocxSummary(buffer)
        : fileType === 'pptx'
          ? await extractPptxSummary(buffer)
          : await extractPdfSummary(buffer)

    return {
      ok: true,
      fileType,
      content,
    }
  } catch (error) {
    return {
      ok: false,
      fileType,
      error: error instanceof Error ? error.message : '自动提取文本失败',
    }
  }
}
