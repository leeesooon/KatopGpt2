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
  const textMatches = elementXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)
  for (const match of textMatches) {
    if (decodeXmlText(match[1]).trim()) return true
  }
  return false
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

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile)?.async('string')
    if (!slideXml) continue

    const slideNumber = slidePathToNumber(slideFile)
    for (const element of getElementBlocks(slideXml)) {
      const box = parseElementBox(element.xml)
      if (!box || isFullSlideBackground(box, slideSize)) continue

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
