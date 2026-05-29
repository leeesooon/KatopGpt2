import fs from 'fs/promises'
import JSZip from 'jszip'
import type { PresentationCodeDiagnostic } from './shared/presentation'

export interface PresentationCodePptxAuditResult {
  ok: boolean
  diagnostics: PresentationCodeDiagnostic[]
}

const EMU_PER_INCH = 914400
const WIDE_WIDTH_IN = 13.333
const WIDE_HEIGHT_IN = 7.5
const SIZE_TOLERANCE_IN = 0.06
const CONTENT_TOLERANCE_IN = 0.03
const MAX_AUDIT_MESSAGES = 12
const MIN_CONTENT_COVERAGE_RATIO = 0.16
const MIN_RICH_VISUAL_SHAPES = 3
const MIN_CONTENT_TEXT_CHARS = 80

interface SlideSize {
  widthEmu: number
  heightEmu: number
  widthIn: number
  heightIn: number
}

interface ElementBox {
  x: number
  y: number
  w: number
  h: number
  right: number
  bottom: number
}

interface OverflowAmount {
  left: number
  top: number
  right: number
  bottom: number
  max: number
}

interface SlideQualityStats {
  contentArea: number
  textChars: number
  contentElementCount: number
  mediaVisualCount: number
  nonTextShapeCount: number
}

function emuToInches(value: number) {
  return value / EMU_PER_INCH
}

function formatInches(value: number) {
  return `${value.toFixed(2)}in`
}

function readXmlAttribute(source: string, name: string) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match?.[1] ?? ''
}

function decodeXmlText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseNumberAttribute(source: string, name: string) {
  const value = Number(readXmlAttribute(source, name))
  return Number.isFinite(value) ? value : 0
}

function parseSlideSize(presentationXml: string): SlideSize | null {
  const match = presentationXml.match(/<p:sldSz\b([^>]*)\/?>/)
  if (!match) return null

  const widthEmu = parseNumberAttribute(match[1], 'cx')
  const heightEmu = parseNumberAttribute(match[1], 'cy')
  if (widthEmu <= 0 || heightEmu <= 0) return null

  return {
    widthEmu,
    heightEmu,
    widthIn: emuToInches(widthEmu),
    heightIn: emuToInches(heightEmu),
  }
}

function slidePathToNumber(path: string) {
  const match = path.match(/slide(\d+)\.xml$/)
  return match ? Number(match[1]) : 0
}

function isWideLayout(size: SlideSize) {
  return Math.abs(size.widthIn - WIDE_WIDTH_IN) <= SIZE_TOLERANCE_IN
    && Math.abs(size.heightIn - WIDE_HEIGHT_IN) <= SIZE_TOLERANCE_IN
}

function getElementBlocks(slideXml: string) {
  const blocks: Array<{ tag: string; xml: string }> = []
  const elementRe = /<p:(sp|pic|graphicFrame|cxnSp)\b[\s\S]*?<\/p:\1>/g
  let match: RegExpExecArray | null

  while ((match = elementRe.exec(slideXml))) {
    blocks.push({
      tag: match[1],
      xml: match[0],
    })
  }

  return blocks
}

function parseElementBox(elementXml: string): ElementBox | null {
  const xfrmMatch = elementXml.match(/<a:xfrm\b[\s\S]*?<a:off\b([^>]*)\/>[\s\S]*?<a:ext\b([^>]*)\/>[\s\S]*?<\/a:xfrm>/)
  if (!xfrmMatch) return null

  const x = parseNumberAttribute(xfrmMatch[1], 'x')
  const y = parseNumberAttribute(xfrmMatch[1], 'y')
  const w = parseNumberAttribute(xfrmMatch[2], 'cx')
  const h = parseNumberAttribute(xfrmMatch[2], 'cy')

  if (w < 0 || h < 0) return null

  return {
    x: emuToInches(x),
    y: emuToInches(y),
    w: emuToInches(w),
    h: emuToInches(h),
    right: emuToInches(x + w),
    bottom: emuToInches(y + h),
  }
}

function parseElementName(elementXml: string) {
  const match = elementXml.match(/<p:cNvPr\b([^>]*)\/?>/)
  const rawName = match ? readXmlAttribute(match[1], 'name') : ''
  return decodeXmlText(rawName || '未命名元素')
}

function hasNonEmptyText(elementXml: string) {
  return getElementText(elementXml).length > 0
}

function getElementText(elementXml: string) {
  const textParts: string[] = []
  const textMatches = elementXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)
  for (const match of textMatches) {
    const text = decodeXmlText(match[1]).trim()
    if (text) textParts.push(text)
  }
  return textParts.join('')
}

function isContentElement(tag: string, elementXml: string) {
  if (hasNonEmptyText(elementXml)) return true
  if (tag === 'graphicFrame') return true
  if (tag === 'pic') return true
  return /<(c:chart|a:tbl)\b/.test(elementXml)
}

function isFullSlideBackground(box: ElementBox, size: SlideSize) {
  return Math.abs(box.x) <= CONTENT_TOLERANCE_IN
    && Math.abs(box.y) <= CONTENT_TOLERANCE_IN
    && Math.abs(box.w - size.widthIn) <= CONTENT_TOLERANCE_IN
    && Math.abs(box.h - size.heightIn) <= CONTENT_TOLERANCE_IN
}

function clampBoxToSlide(box: ElementBox, size: SlideSize): ElementBox | null {
  const x = Math.max(0, Math.min(size.widthIn, box.x))
  const y = Math.max(0, Math.min(size.heightIn, box.y))
  const right = Math.max(0, Math.min(size.widthIn, box.right))
  const bottom = Math.max(0, Math.min(size.heightIn, box.bottom))
  const w = Math.max(0, right - x)
  const h = Math.max(0, bottom - y)
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h, right, bottom }
}

function getClampedBoxArea(box: ElementBox, size: SlideSize) {
  const clamped = clampBoxToSlide(box, size)
  return clamped ? clamped.w * clamped.h : 0
}

function isThinLineBox(box: ElementBox) {
  return box.w <= 0.06 || box.h <= 0.06 || box.w * box.h <= 0.015
}

function hasChartOrTable(elementXml: string) {
  return /<(c:chart|a:tbl)\b/.test(elementXml)
}

function estimateTextContentArea(box: ElementBox, text: string, size: SlideSize) {
  const compactText = text.replace(/\s+/g, '')
  if (!compactText) return 0
  const clampedArea = getClampedBoxArea(box, size)
  const estimatedLineCount = Math.max(1, Math.ceil(compactText.length / 24))
  const estimatedArea = Math.min(box.w, size.widthIn - 1.2) * estimatedLineCount * 0.24
  return Math.min(clampedArea, Math.max(0.1, estimatedArea))
}

function estimateContentArea(tag: string, elementXml: string, box: ElementBox, size: SlideSize) {
  if (isFullSlideBackground(box, size)) return 0
  if (tag === 'pic' || tag === 'graphicFrame' || hasChartOrTable(elementXml)) {
    return getClampedBoxArea(box, size)
  }

  const text = getElementText(elementXml)
  if (text) {
    return estimateTextContentArea(box, text, size)
  }

  if (tag === 'sp' && !isThinLineBox(box)) {
    return getClampedBoxArea(box, size) * 0.55
  }

  return 0
}

function updateSlideQualityStats(
  stats: SlideQualityStats,
  tag: string,
  elementXml: string,
  box: ElementBox,
  size: SlideSize
) {
  if (isFullSlideBackground(box, size)) return

  const text = getElementText(elementXml)
  const contentArea = estimateContentArea(tag, elementXml, box, size)
  if (contentArea > 0) {
    stats.contentArea += contentArea
    stats.contentElementCount += 1
  }
  if (text) {
    stats.textChars += text.replace(/\s+/g, '').length
  }
  if (tag === 'pic' || tag === 'graphicFrame' || hasChartOrTable(elementXml)) {
    stats.mediaVisualCount += 1
  }
  if (tag === 'sp' && !text && !isThinLineBox(box)) {
    stats.nonTextShapeCount += 1
  }
}

function getOverflow(box: ElementBox, size: SlideSize): OverflowAmount {
  const left = Math.max(0, -box.x)
  const top = Math.max(0, -box.y)
  const right = Math.max(0, box.right - size.widthIn)
  const bottom = Math.max(0, box.bottom - size.heightIn)

  return {
    left,
    top,
    right,
    bottom,
    max: Math.max(left, top, right, bottom),
  }
}

function formatOverflowDirections(overflow: OverflowAmount) {
  return [
    overflow.left > CONTENT_TOLERANCE_IN ? `左侧 ${formatInches(overflow.left)}` : '',
    overflow.top > CONTENT_TOLERANCE_IN ? `顶部 ${formatInches(overflow.top)}` : '',
    overflow.right > CONTENT_TOLERANCE_IN ? `右侧 ${formatInches(overflow.right)}` : '',
    overflow.bottom > CONTENT_TOLERANCE_IN ? `底部 ${formatInches(overflow.bottom)}` : '',
  ].filter(Boolean).join('、')
}

function makeOverflowMessage(slideNumber: number, elementName: string, box: ElementBox, overflow: OverflowAmount) {
  const directionText = formatOverflowDirections(overflow)
  return `第 ${slideNumber} 页「${elementName}」内容元素越界：x=${formatInches(box.x)}，y=${formatInches(box.y)}，w=${formatInches(box.w)}，h=${formatInches(box.h)}，${directionText}。`
}

function isMiddleSlide(slideNumber: number, slideCount: number) {
  return slideNumber > 1 && slideNumber < slideCount
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function addQualityDiagnostics(
  diagnostics: PresentationCodeDiagnostic[],
  slideNumber: number,
  slideCount: number,
  stats: SlideQualityStats,
  slideSize: SlideSize
) {
  if (!isMiddleSlide(slideNumber, slideCount)) return

  const slideArea = slideSize.widthIn * slideSize.heightIn
  const coverageRatio = slideArea > 0 ? stats.contentArea / slideArea : 0
  const hasRichVisual = stats.mediaVisualCount > 0 || stats.nonTextShapeCount >= MIN_RICH_VISUAL_SHAPES

  if (coverageRatio < MIN_CONTENT_COVERAGE_RATIO && diagnostics.length < MAX_AUDIT_MESSAGES) {
    diagnostics.push({
      level: 'warning',
      message: `第 ${slideNumber} 页主体内容覆盖率偏低（估算 ${formatPercent(coverageRatio)}），建议补充语义矢量图、卡片网格、流程线或练习/案例组件，避免大块留白。`,
    })
  }

  if (!hasRichVisual && diagnostics.length < MAX_AUDIT_MESSAGES) {
    diagnostics.push({
      level: 'warning',
      message: `第 ${slideNumber} 页缺少语义矢量图、图表、图片或足够丰富的图形结构，建议使用 tools.addSemanticSvg 或增加流程/对比/清单组件。`,
    })
  }

  if (stats.textChars < MIN_CONTENT_TEXT_CHARS && stats.contentElementCount <= 3 && diagnostics.length < MAX_AUDIT_MESSAGES) {
    diagnostics.push({
      level: 'warning',
      message: `第 ${slideNumber} 页可见内容偏少，建议把短要点扩展成并列目标卡、概念/示例/练习三栏或 2x2 信息网格。`,
    })
  }
}

export async function auditPresentationCodePptx(pptxPath: string): Promise<PresentationCodePptxAuditResult> {
  const diagnostics: PresentationCodeDiagnostic[] = []
  const buffer = await fs.readFile(pptxPath)
  const zip = await JSZip.loadAsync(buffer)
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string')

  if (!presentationXml) {
    return {
      ok: false,
      diagnostics: [{
        level: 'error',
        message: 'PPTX 越界审计失败：无法读取 ppt/presentation.xml。',
      }],
    }
  }

  const slideSize = parseSlideSize(presentationXml)
  if (!slideSize) {
    return {
      ok: false,
      diagnostics: [{
        level: 'error',
        message: 'PPTX 越界审计失败：无法读取真实画布尺寸。',
      }],
    }
  }

  if (!isWideLayout(slideSize)) {
    diagnostics.push({
      level: 'error',
      message: `PPTX 画布不是 LAYOUT_WIDE：当前为 ${formatInches(slideSize.widthIn)} x ${formatInches(slideSize.heightIn)}，必须使用 13.33in x 7.50in。`,
    })
  }

  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((a, b) => slidePathToNumber(a) - slidePathToNumber(b))

  let hiddenOverflowCount = 0
  const slideCount = slideFiles.length

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile)?.async('string')
    if (!slideXml) continue

    const slideNumber = slidePathToNumber(slideFile)
    const qualityStats: SlideQualityStats = {
      contentArea: 0,
      textChars: 0,
      contentElementCount: 0,
      mediaVisualCount: 0,
      nonTextShapeCount: 0,
    }

    for (const element of getElementBlocks(slideXml)) {
      const box = parseElementBox(element.xml)
      if (!box || isFullSlideBackground(box, slideSize)) continue
      updateSlideQualityStats(qualityStats, element.tag, element.xml, box, slideSize)

      const overflow = getOverflow(box, slideSize)
      if (overflow.max <= CONTENT_TOLERANCE_IN) continue

      const isContent = isContentElement(element.tag, element.xml)
      if (!isContent) continue

      const message = makeOverflowMessage(
        slideNumber,
        parseElementName(element.xml),
        box,
        overflow
      )

      if (diagnostics.length < MAX_AUDIT_MESSAGES) {
        diagnostics.push({
          level: 'error',
          message,
        })
      } else {
        hiddenOverflowCount += 1
      }
    }

    addQualityDiagnostics(diagnostics, slideNumber, slideCount, qualityStats, slideSize)
  }

  if (hiddenOverflowCount > 0) {
    diagnostics.push({
      level: 'error',
      message: `还有 ${hiddenOverflowCount} 个内容越界元素未逐条展示，请整体收紧页面坐标和文本框尺寸。`,
    })
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    diagnostics,
  }
}
