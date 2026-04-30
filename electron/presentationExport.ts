import type { BrowserWindow } from 'electron'
import { app, dialog } from 'electron'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import pptxgen from 'pptxgenjs'
import {
  auditPresentationDeckSpec,
  presentationDeckSpecSchema,
  type PresentationSvgVisualSpec,
  type PresentationChartData,
  type PresentationDeckSpec,
  type PresentationExportRequest,
  type PresentationExportResult,
  type PresentationPreviewRequest,
  type PresentationPreviewResult,
  type PresentationSlideSpec,
} from './shared/presentation'
import { checkPresentationRenderTools, removePresentationTempDirectory, renderPresentationPreviewImages } from './presentationPreview'
import { getPresentationTheme, type PresentationExportTheme } from './presentationThemes'

const SLIDE_WIDTH = 10
const SLIDE_HEIGHT = 5.625
const SAFE_MARGIN = 0.5

type PptxInstance = InstanceType<typeof pptxgen>
type PptxSlide = ReturnType<PptxInstance['addSlide']>
type PptxShapeName = Parameters<PptxSlide['addShape']>[0]

function makeShadow(opacity = 0.14, blur = 8) {
  return { type: 'outer' as const, color: '000000', blur, offset: 2, angle: 135, opacity }
}

function safeFileName(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return sanitized || `KatopGPT-PPT-${Date.now()}`
}

function withPptxExtension(filePath: string) {
  return filePath.toLowerCase().endsWith('.pptx') ? filePath : `${filePath}.pptx`
}

function clip(value: string | undefined, maxChars: number) {
  if (!value) return ''
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}...`
}

function visualBox(box: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number) {
  return {
    x: box.x + box.w * x,
    y: box.y + box.h * y,
    w: box.w * w,
    h: box.h * h,
  }
}

function addVisualShape(
  slide: PptxSlide,
  shape: PptxShapeName,
  box: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; line?: string; transparency?: number; lineTransparency?: number; lineWidth?: number; radius?: number } = {}
) {
  const rawPosition = visualBox(box, x, y, w, h)
  const isLine = shape === 'line'
  const position = isLine
    ? {
        x: rawPosition.x + Math.min(rawPosition.w, 0),
        y: rawPosition.y + Math.min(rawPosition.h, 0),
        w: Math.abs(rawPosition.w),
        h: Math.abs(rawPosition.h),
      }
    : rawPosition
  slide.addShape(shape, {
    ...position,
    ...(isLine && rawPosition.w < 0 ? { flipH: true } : {}),
    ...(isLine && rawPosition.h < 0 ? { flipV: true } : {}),
    ...(opts.radius ? { rectRadius: opts.radius } : {}),
    fill: opts.fill
      ? { color: opts.fill, transparency: opts.transparency ?? 0 }
      : { color: 'FFFFFF', transparency: 100 },
    line: {
      color: opts.line ?? opts.fill ?? 'FFFFFF',
      transparency: opts.lineTransparency ?? (opts.line ? 0 : 100),
      width: opts.lineWidth ?? 1,
    },
  })
}

function addVisualText(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  box: { x: number; y: number; w: number; h: number },
  text: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { color?: string; size?: number; dark?: boolean; align?: 'left' | 'center' | 'right' } = {}
) {
  if (!text) return
  slide.addText(clip(text, 18), {
    ...visualBox(box, x, y, w, h),
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: opts.size ?? 16,
    bold: true,
    color: opts.color ?? (opts.dark ? theme.accent : theme.primary),
    align: opts.align ?? 'center',
    fit: 'shrink',
  })
}

function addSvgVisual(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  spec: PresentationSlideSpec,
  index: number,
  box: { x: number; y: number; w: number; h: number },
  fallbackKind?: PresentationSvgVisualSpec['kind']
) {
  const visual = {
    ...(spec.svgVisual ?? {}),
    kind: fallbackKind ?? spec.svgVisual?.kind ?? 'mesh',
    label: spec.svgVisual?.label ?? spec.visual.label,
    seed: spec.svgVisual?.seed ?? index + 17,
  }
  const label = visual.label || spec.visualFocus || spec.visual.label || spec.title
  const items = (spec.callouts?.length ? spec.callouts : spec.visual.items?.length ? spec.visual.items : spec.bullets).slice(0, 4)
  const isFullSlide = box.w >= SLIDE_WIDTH - 0.1 && box.h >= SLIDE_HEIGHT - 0.1

  if (visual.kind === 'orbital') {
    if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.dark, transparency: 0 })
    addVisualShape(slide, 'ellipse', box, 0.66, 0.14, 0.42, 0.74, { fill: theme.primary, transparency: 12, lineTransparency: 100 })
    addVisualShape(slide, 'ellipse', box, 0.72, 0.25, 0.3, 0.52, { line: theme.secondary, lineTransparency: 32, lineWidth: 3 })
    addVisualShape(slide, 'ellipse', box, 0.79, 0.38, 0.16, 0.28, { line: theme.accent, lineTransparency: 44, lineWidth: 1.4 })
    addVisualShape(slide, 'ellipse', box, 0.62, 0.22, 0.05, 0.09, { fill: theme.secondary, transparency: 0, lineTransparency: 100 })
    addVisualShape(slide, 'ellipse', box, 0.9, 0.66, 0.035, 0.06, { fill: theme.accent, transparency: 6, lineTransparency: 100 })
    addVisualShape(slide, 'line', box, 0.52, 0.68, 0.38, -0.12, { line: theme.secondary, lineTransparency: 62, lineWidth: 2 })
    if (!isFullSlide) {
      addVisualText(slide, theme, box, label, 0.7, 0.47, 0.32, 0.11, { color: theme.accent, size: 13 })
    }
    return
  }

  if (visual.kind === 'process') {
    if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.paper, transparency: 0 })
    addVisualShape(slide, 'line', box, 0.08, 0.5, 0.84, 0, { line: theme.secondary, lineTransparency: 54, lineWidth: 4 })
    if (isFullSlide) return
    items.forEach((item, itemIndex) => {
      const x = 0.12 + itemIndex * 0.2
      const y = itemIndex % 2 === 0 ? 0.36 : 0.48
      const isPrimary = itemIndex % 2 === 0
      addVisualShape(slide, 'roundRect', box, x, y, 0.16, 0.15, {
        fill: isPrimary ? theme.primary : theme.card,
        line: theme.secondary,
        lineTransparency: 34,
        lineWidth: 1,
        radius: 0.08,
      })
      addVisualShape(slide, 'ellipse', box, x + 0.02, y + 0.04, 0.035, 0.06, {
        fill: isPrimary ? theme.accent : theme.primary,
        lineTransparency: 100,
      })
      addVisualText(slide, theme, box, item, x + 0.06, y + 0.055, 0.08, 0.04, {
        color: isPrimary ? theme.accent : theme.dark,
        size: isFullSlide ? 11 : 7,
        align: 'left',
      })
    })
    return
  }

  if (visual.kind === 'network') {
    addVisualShape(slide, 'ellipse', box, 0.68, -0.08, 0.42, 0.45, { fill: theme.light, transparency: 0, lineTransparency: 100 })
    const nodes = [
      [0.2, 0.24, 0.12],
      [0.44, 0.42, 0.18],
      [0.72, 0.28, 0.13],
      [0.78, 0.68, 0.14],
      [0.31, 0.7, 0.1],
    ] as const
    ;[[0, 1], [1, 2], [1, 3], [1, 4], [2, 3], [4, 3]].forEach(([from, to]) => {
      const a = nodes[from]
      const b = nodes[to]
      addVisualShape(slide, 'line', box, a[0] + a[2] / 2, a[1] + a[2] / 2, b[0] - a[0], b[1] - a[1], {
        line: theme.secondary,
        lineTransparency: 64,
        lineWidth: 1.5,
      })
    })
    nodes.forEach(([x, y, size], itemIndex) => {
      addVisualShape(slide, 'ellipse', box, x, y, size, size * 1.1, {
        fill: itemIndex === 1 ? theme.primary : theme.card,
        line: theme.secondary,
        lineTransparency: 28,
        lineWidth: 1,
      })
    })
    if (!isFullSlide) {
      addVisualText(slide, theme, box, label, 0.38, 0.46, 0.24, 0.08, { color: theme.accent, size: 10 })
    }
    return
  }

  if (visual.kind === 'architecture') {
    addVisualShape(slide, 'rect', box, 0, 0, 0.34, 1, { fill: theme.light, transparency: 0, lineTransparency: 100 })
    items.forEach((item, itemIndex) => {
      const x = 0.32 + itemIndex * 0.08
      const y = 0.24 + itemIndex * 0.13
      addVisualShape(slide, 'roundRect', box, x, y, 0.34, 0.1, {
        fill: itemIndex % 2 === 0 ? theme.primary : theme.card,
        line: theme.secondary,
        lineTransparency: 35,
        lineWidth: 1,
        radius: 0.08,
      })
      addVisualText(slide, theme, box, item, x + 0.03, y + 0.032, 0.27, 0.04, {
        color: itemIndex % 2 === 0 ? theme.accent : theme.dark,
        size: isFullSlide ? 11 : 7,
        align: 'left',
      })
    })
    addVisualShape(slide, 'rect', box, 0.18, 0.25, 0.12, 0.44, { line: theme.secondary, lineTransparency: 68, lineWidth: 2 })
    addVisualShape(slide, 'ellipse', box, 0.76, 0.25, 0.18, 0.36, { line: theme.primary, lineTransparency: 76, lineWidth: 2 })
    return
  }

  if (visual.kind === 'radar') {
    if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.dark, transparency: 0 })
    ;[0.62, 0.42, 0.22].forEach((size, sizeIndex) => {
      addVisualShape(slide, 'ellipse', box, 0.5 - size / 2, 0.5 - size / 2, size, size, {
        line: theme.secondary,
        lineTransparency: 70 - sizeIndex * 8,
        lineWidth: 1.2,
      })
    })
    ;[[0, -0.34], [0.3, -0.18], [0.3, 0.18], [0, 0.34], [-0.3, 0.18], [-0.3, -0.18]].forEach(([dx, dy]) => {
      addVisualShape(slide, 'line', box, 0.5, 0.5, dx, dy, { line: theme.secondary, lineTransparency: 72, lineWidth: 1 })
    })
    addVisualShape(slide, 'ellipse', box, 0.36, 0.27, 0.3, 0.36, { fill: theme.primary, transparency: 32, line: theme.accent, lineTransparency: 18, lineWidth: 2 })
    addVisualShape(slide, 'ellipse', box, 0.485, 0.485, 0.03, 0.03, { fill: theme.accent, lineTransparency: 100 })
    return
  }

  if (visual.kind === 'burst') {
    if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.primary, transparency: 0 })
    addVisualShape(slide, 'ellipse', box, 0.62, 0.02, 0.55, 0.92, { fill: theme.secondary, transparency: 82, lineTransparency: 100 })
    addVisualShape(slide, 'ellipse', box, 0.72, 0.24, 0.32, 0.54, { fill: theme.dark, transparency: 72, lineTransparency: 100 })
    addVisualShape(slide, 'ellipse', box, 0.76, 0.34, 0.22, 0.34, { fill: theme.accent, transparency: 78, lineTransparency: 100 })
    addVisualText(slide, theme, box, spec.heroMetric?.value, 0.73, 0.44, 0.28, 0.13, { color: theme.accent, size: isFullSlide ? 42 : 18 })
    return
  }

  if (visual.kind === 'texture') {
    if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.paper, transparency: 0 })
    addVisualShape(slide, 'ellipse', box, -0.08, 0.72, 1.2, 0.42, { fill: theme.light, transparency: 0, lineTransparency: 100 })
    addVisualShape(slide, 'line', box, -0.05, 0.18, 1.1, -0.09, { line: theme.secondary, lineTransparency: 78, lineWidth: 7 })
    addVisualShape(slide, 'line', box, -0.08, 0.32, 1.08, -0.1, { line: theme.primary, lineTransparency: 82, lineWidth: 4 })
    return
  }

  if (isFullSlide) addVisualShape(slide, 'rect', box, 0, 0, 1, 1, { fill: theme.paper, transparency: 0 })
  addVisualShape(slide, 'ellipse', box, 0.73, -0.05, 0.48, 0.52, { fill: theme.light, transparency: 0, lineTransparency: 100 })
  addVisualShape(slide, 'ellipse', box, 0.08, 0.18, 0.22, 0.3, { fill: theme.primary, transparency: 82, lineTransparency: 100 })
  addVisualShape(slide, 'ellipse', box, 0.48, 0.12, 0.2, 0.25, { fill: theme.secondary, transparency: 86, lineTransparency: 100 })
  addVisualShape(slide, 'ellipse', box, 0.72, 0.55, 0.26, 0.32, { fill: theme.accent, transparency: 88, lineTransparency: 100 })
  addVisualShape(slide, 'line', box, 0.12, 0.2, 0.74, 0.18, { line: theme.primary, lineTransparency: 76, lineWidth: 1.8 })
  addVisualShape(slide, 'line', box, 0.18, 0.78, 0.7, -0.22, { line: theme.secondary, lineTransparency: 68, lineWidth: 2.2 })
}

function addSlideNotes(slide: PptxSlide, spec: PresentationSlideSpec) {
  if (!spec.speakerNotes?.trim()) return
  slide.addNotes(spec.speakerNotes.trim())
}

function addPageNumber(slide: PptxSlide, theme: PresentationExportTheme, index: number, total: number, isDark = false) {
  slide.addText(`${index + 1}/${total}`, {
    x: 8.88,
    y: 5.08,
    w: 0.64,
    h: 0.18,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    color: isDark ? theme.secondary : theme.muted,
    align: 'right',
  })
}

function addEyebrow(slide: PptxSlide, theme: PresentationExportTheme, text: string | undefined, isDark = false) {
  if (!text) return
  slide.addText(clip(text, 26).toUpperCase(), {
    x: SAFE_MARGIN,
    y: 0.36,
    w: 4.8,
    h: 0.22,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    charSpacing: 1.6,
    color: isDark ? theme.secondary : theme.primary,
  })
}

function addTitle(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  title: string,
  opts: { x?: number; y?: number; w?: number; h?: number; dark?: boolean; size?: number } = {}
) {
  slide.addText(clip(title, 46), {
    x: opts.x ?? SAFE_MARGIN,
    y: opts.y ?? 0.76,
    w: opts.w ?? 6.2,
    h: opts.h ?? 0.72,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: opts.size ?? 36,
    bold: true,
    color: opts.dark ? theme.accent : theme.dark,
    fit: 'shrink',
    breakLine: false,
  })
}

function addSubtitle(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  subtitle: string | undefined,
  opts: { x?: number; y?: number; w?: number; h?: number; dark?: boolean; size?: number } = {}
) {
  if (!subtitle) return
  slide.addText(clip(subtitle, 88), {
    x: opts.x ?? SAFE_MARGIN,
    y: opts.y ?? 1.62,
    w: opts.w ?? 5.8,
    h: opts.h ?? 0.56,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: opts.size ?? 14,
    color: opts.dark ? theme.secondary : theme.muted,
    fit: 'shrink',
    breakLine: false,
  })
}

function addBulletList(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  bullets: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  isDark = false,
  fontSize = 13
) {
  const textRuns = bullets.slice(0, 5).map((bullet, index) => ({
    text: clip(bullet, 52),
    options: {
      bullet: true,
      breakLine: index < Math.min(bullets.length, 5) - 1,
      paraSpaceAfter: 8,
    },
  }))

  if (textRuns.length === 0) return

  slide.addText(textRuns, {
    x,
    y,
    w,
    h,
    fontFace: theme.bodyFont,
    fontSize,
    color: isDark ? theme.light : theme.dark,
    margin: [2, 6, 2, 8],
    fit: 'shrink',
    breakLine: true,
  })
}

function addCornerLabel(slide: PptxSlide, theme: PresentationExportTheme, label: string, isDark = false) {
  slide.addShape('roundRect', {
    x: 0.54,
    y: 4.82,
    w: 2.25,
    h: 0.3,
    rectRadius: 0.08,
    fill: { color: isDark ? theme.primary : theme.light, transparency: isDark ? 4 : 0 },
    line: { color: isDark ? theme.secondary : theme.secondary, transparency: 58, width: 0.8 },
  })
  slide.addText(clip(label, 24), {
    x: 0.72,
    y: 4.9,
    w: 1.88,
    h: 0.11,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 7,
    bold: true,
    charSpacing: 1.4,
    color: isDark ? theme.secondary : theme.primary,
    align: 'center',
  })
}

function addHeroMetric(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, box: { x: number; y: number; w: number; dark?: boolean }) {
  const metric = spec.heroMetric ?? spec.visual.stats?.[0]
  if (!metric) return
  slide.addText(clip(metric.value, 14), {
    x: box.x,
    y: box.y,
    w: box.w,
    h: 0.7,
    margin: 0,
    fontFace: 'Georgia',
    fontSize: 58,
    bold: true,
    color: box.dark ? theme.accent : theme.primary,
    fit: 'shrink',
  })
  slide.addText(clip(metric.label, 38), {
    x: box.x + 0.04,
    y: box.y + 0.86,
    w: box.w - 0.08,
    h: 0.24,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 10,
    bold: true,
    color: box.dark ? theme.secondary : theme.muted,
    fit: 'shrink',
  })
}

interface SlidePointParts {
  heading: string
  detail: string
}

function uniquePresentationTexts(items: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function splitSlidePoint(value: string): SlidePointParts {
  const text = value.trim()
  const separatorIndices: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (/[：:，；。]/.test(text[index])) separatorIndices.push(index)
  }
  const firstUsableSeparator = separatorIndices.find((index) => index >= 4 && index <= 22)
  const secondClauseSeparator = separatorIndices.find((index) => index >= 8 && index <= 22)
  const separatorIndex = firstUsableSeparator ?? secondClauseSeparator ?? -1
  if (separatorIndex >= 0) {
    return {
      heading: clip(text.slice(0, separatorIndex), 18),
      detail: clip(text.slice(separatorIndex + 1), 76),
    }
  }

  const headingLength = Math.min(16, Math.max(8, Math.ceil(text.length * 0.36)))
  return {
    heading: clip(text.slice(0, headingLength), 18),
    detail: clip(text.length > headingLength ? text.slice(headingLength) : text, 76),
  }
}

function getSlidePoints(spec: PresentationSlideSpec, maxItems: number) {
  const items = uniquePresentationTexts([
    ...spec.bullets,
    ...(spec.visual.items ?? []),
    ...(spec.callouts ?? []),
  ])
  const source = items.length > 0 ? items : [spec.visual.label || spec.visualFocus || spec.title]
  return source.slice(0, maxItems).map(splitSlidePoint)
}

function addPointCard(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  point: SlidePointParts,
  itemIndex: number,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { accent?: boolean; compact?: boolean } = {}
) {
  const isAccent = Boolean(opts.accent)
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: isAccent ? theme.primary : theme.card, transparency: 0 },
    line: { color: isAccent ? theme.primary : theme.secondary, transparency: 36, width: 0.8 },
    shadow: makeShadow(0.1, 8),
  })
  slide.addShape('ellipse', {
    x: x + 0.22,
    y: y + 0.22,
    w: 0.38,
    h: 0.38,
    fill: { color: isAccent ? theme.secondary : theme.primary },
    line: { color: theme.secondary, transparency: 100 },
  })
  slide.addText(String(itemIndex + 1), {
    x: x + 0.22,
    y: y + 0.31,
    w: 0.38,
    h: 0.12,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    align: 'center',
    color: isAccent ? theme.dark : theme.accent,
  })
  slide.addText(point.heading, {
    x: x + 0.78,
    y: y + 0.2,
    w: w - 1.02,
    h: 0.24,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: opts.compact ? 10.5 : 12,
    bold: true,
    color: isAccent ? theme.accent : theme.dark,
    fit: 'shrink',
  })
  slide.addText(point.detail, {
    x: x + 0.78,
    y: y + 0.52,
    w: w - 1.04,
    h: h - 0.68,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: opts.compact ? 7.8 : 8.6,
    color: isAccent ? theme.secondary : theme.muted,
    breakLine: false,
    fit: 'shrink',
    valign: 'top',
  })
}

function addInsightRows(
  slide: PptxSlide,
  theme: PresentationExportTheme,
  points: SlidePointParts[],
  x: number,
  y: number,
  w: number,
  isDark = false
) {
  points.forEach((point, itemIndex) => {
    const rowY = y + itemIndex * 0.58
    slide.addShape('ellipse', {
      x,
      y: rowY + 0.04,
      w: 0.18,
      h: 0.18,
      fill: { color: isDark ? theme.secondary : theme.primary },
      line: { color: theme.secondary, transparency: 100 },
    })
    slide.addText(point.heading, {
      x: x + 0.3,
      y: rowY,
      w,
      h: 0.15,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 8.4,
      bold: true,
      color: isDark ? theme.light : theme.dark,
      fit: 'shrink',
      breakLine: false,
    })
    slide.addText(point.detail, {
      x: x + 0.3,
      y: rowY + 0.2,
      w,
      h: 0.25,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 7.1,
      color: isDark ? theme.secondary : theme.muted,
      fit: 'shrink',
      breakLine: false,
    })
  })
}

function renderCover(slide: PptxSlide, theme: PresentationExportTheme, deck: PresentationDeckSpec, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.dark }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'orbital')
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 6.55,
    h: SLIDE_HEIGHT,
    fill: { color: theme.dark, transparency: 8 },
    line: { color: theme.dark, transparency: 100 },
  })
  slide.addText(theme.name, {
    x: SAFE_MARGIN,
    y: 0.58,
    w: 4.1,
    h: 0.22,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    charSpacing: 2.4,
    color: theme.secondary,
  })
  addTitle(slide, theme, spec.title || deck.title, { y: 1.26, w: 6.0, h: 1.38, dark: true, size: 42 })
  addSubtitle(slide, theme, spec.subtitle || deck.subtitle || deck.goal, { y: 2.84, w: 5.62, h: 0.64, dark: true, size: 15 })
  addHeroMetric(slide, theme, spec, { x: 0.58, y: 3.72, w: 2.8, dark: true })
  slide.addText(`${deck.slides.length} SLIDES`, {
    x: 4.78,
    y: 4.92,
    w: 1.2,
    h: 0.16,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    charSpacing: 1.6,
    color: theme.secondary,
    align: 'right',
  })
}

function renderAgenda(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, deck: PresentationDeckSpec, index: number) {
  slide.background = { color: theme.paper }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'texture')
  addEyebrow(slide, theme, spec.eyebrow || 'AGENDA')
  addTitle(slide, theme, spec.title, { y: 0.68, w: 5.4, size: 36 })
  const agendaItems = (spec.visual.items?.length ? spec.visual.items : deck.slides.slice(1, 7).map((item) => item.title)).slice(0, 6)
  agendaItems.forEach((item, itemIndex) => {
    const y = 1.48 + itemIndex * 0.56
    slide.addShape('roundRect', {
      x: 0.62 + (itemIndex % 2) * 0.16,
      y,
      w: 8.28,
      h: 0.42,
      rectRadius: 0.08,
      fill: { color: itemIndex % 2 === 0 ? theme.card : theme.light, transparency: 0 },
      line: { color: theme.secondary, transparency: 42, width: 0.8 },
      shadow: makeShadow(0.06, 5),
    })
    slide.addText(String(itemIndex + 1).padStart(2, '0'), {
      x: 0.86 + (itemIndex % 2) * 0.16,
      y: y + 0.12,
      w: 0.44,
      h: 0.13,
      margin: 0,
      fontFace: 'Georgia',
      fontSize: 10,
      bold: true,
      color: theme.primary,
      align: 'center',
    })
    slide.addText(clip(item, 42), {
      x: 1.46 + (itemIndex % 2) * 0.16,
      y: y + 0.1,
      w: 6.9,
      h: 0.19,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 12,
      bold: true,
      color: theme.dark,
      fit: 'shrink',
    })
  })
}

function renderSection(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.primary }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'burst')
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 6.48,
    h: SLIDE_HEIGHT,
    fill: { color: theme.primary, transparency: 8 },
    line: { color: theme.primary, transparency: 100 },
  })
  slide.addText(String(index + 1).padStart(2, '0'), {
    x: 0.56,
    y: 0.62,
    w: 1.2,
    h: 0.74,
    margin: 0,
    fontFace: 'Georgia',
    fontSize: 44,
    bold: true,
    color: theme.secondary,
  })
  addTitle(slide, theme, spec.title, { x: 0.58, y: 1.72, w: 6.0, h: 0.98, dark: true, size: 40 })
  addSubtitle(slide, theme, spec.subtitle || spec.visualFocus || spec.visual.label, { x: 0.62, y: 2.86, w: 5.55, h: 0.58, dark: true, size: 14 })
  addBulletList(slide, theme, spec.bullets.slice(0, 3), 6.72, 1.52, 2.4, 2.08, true, 12)
}

function renderCards(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.paper }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'mesh')
  addEyebrow(slide, theme, spec.eyebrow || spec.visual.label)
  addTitle(slide, theme, spec.title, { y: 0.68, w: 6.4, size: 34 })
  const points = getSlidePoints(spec, 4)

  if (spec.slideVariant === 'metric_wall') {
    const [firstPoint, ...restPoints] = points
    addPointCard(slide, theme, firstPoint, 0, 0.62, 1.56, 4.24, 2.9, { accent: true })
    restPoints.slice(0, 3).forEach((point, itemIndex) => {
      addPointCard(slide, theme, point, itemIndex + 1, 5.16, 1.56 + itemIndex * 0.98, 3.88, 0.78, { compact: true })
    })
    return
  }

  points.forEach((point, itemIndex) => {
    const x = 0.62 + (itemIndex % 2) * 4.42
    const y = 1.46 + Math.floor(itemIndex / 2) * 1.48
    const isAccentCard = itemIndex === 0 || itemIndex === 3
    addPointCard(slide, theme, point, itemIndex, x, y, 3.94, 1.2, { accent: isAccentCard })
  })
}

function renderTwoColumn(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.paper }
  const isSplitHero = spec.slideVariant === 'split_hero'
  if (isSplitHero) {
    slide.addShape('rect', {
      x: 0,
      y: 0,
      w: 4.52,
      h: SLIDE_HEIGHT,
      fill: { color: theme.light, transparency: 0 },
      line: { color: theme.light, transparency: 100 },
    })
    slide.addShape('roundRect', {
      x: 0.58,
      y: 0.78,
      w: 3.48,
      h: 4.0,
      rectRadius: 0.16,
      fill: { color: theme.card, transparency: 0 },
      line: { color: theme.secondary, transparency: 46, width: 1 },
      shadow: makeShadow(0.13, 10),
    })
    addSvgVisual(slide, theme, spec, index, { x: 0.72, y: 0.94, w: 3.2, h: 3.68 }, 'network')
    slide.addText(clip(spec.eyebrow || spec.visual.label, 26).toUpperCase(), {
      x: 4.88,
      y: 0.42,
      w: 3.9,
      h: 0.22,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 8,
      bold: true,
      charSpacing: 1.6,
      color: theme.primary,
    })
    addTitle(slide, theme, spec.title, { x: 4.88, y: 0.76, w: 4.32, size: 34 })
    addSubtitle(slide, theme, spec.subtitle, { x: 4.9, y: 1.52, w: 3.88, size: 12 })
    addBulletList(slide, theme, spec.bullets, 4.88, 2.14, 4.24, 2.32)
    return
  }

  addEyebrow(slide, theme, spec.eyebrow || spec.visual.label)
  addTitle(slide, theme, spec.title, { y: 0.66, w: 5.64, size: 34 })
  addSubtitle(slide, theme, spec.subtitle, { y: 1.42, w: 4.72, size: 12 })
  addBulletList(slide, theme, spec.bullets, 0.58, 2.08, 4.28, 2.38)
  slide.addShape('rect', {
    x: 5.24,
    y: 0,
    w: 4.76,
    h: SLIDE_HEIGHT,
    fill: { color: theme.light, transparency: 0 },
    line: { color: theme.light, transparency: 100 },
  })
  slide.addShape('roundRect', {
    x: 5.68,
    y: 0.78,
    w: 3.72,
    h: 3.92,
    rectRadius: 0.16,
    fill: { color: theme.card, transparency: 0 },
    line: { color: theme.secondary, transparency: 46, width: 1 },
    shadow: makeShadow(0.13, 10),
  })
  addSvgVisual(slide, theme, spec, index, { x: 5.8, y: 0.9, w: 3.48, h: 3.68 }, spec.layout === 'two_column' ? 'network' : 'architecture')
}

function renderTimeline(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.paper }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'process')
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: 1.36,
    fill: { color: theme.paper, transparency: 8 },
    line: { color: theme.paper, transparency: 100 },
  })
  addEyebrow(slide, theme, spec.eyebrow || 'ROADMAP')
  addTitle(slide, theme, spec.title, { y: 0.58, w: 6.5, size: 34 })
  const points = getSlidePoints(spec, 5)

  const shouldUseStackedTimeline = spec.slideVariant !== 'process_ribbon'
    || points.length >= 4
    || points.some((point) => point.heading.length + point.detail.length > 34)
  if (shouldUseStackedTimeline) {
    points.slice(0, 4).forEach((point, itemIndex) => {
      const y = 1.52 + itemIndex * 0.82
      slide.addShape('roundRect', {
        x: 0.7,
        y,
        w: 8.42,
        h: 0.62,
        rectRadius: 0.08,
        fill: { color: itemIndex % 2 === 0 ? theme.card : theme.light },
        line: { color: theme.secondary, transparency: 46, width: 0.8 },
        shadow: makeShadow(0.06, 5),
      })
      slide.addText(String(itemIndex + 1).padStart(2, '0'), {
        x: 0.98,
        y: y + 0.18,
        w: 0.44,
        h: 0.13,
        margin: 0,
        fontFace: 'Georgia',
        fontSize: 11,
        bold: true,
        color: theme.primary,
        align: 'center',
      })
      slide.addText(point.heading, {
        x: 1.62,
        y: y + 0.12,
        w: 1.7,
        h: 0.2,
        margin: 0,
        fontFace: theme.bodyFont,
        fontSize: 11,
        bold: true,
        color: theme.dark,
        fit: 'shrink',
      })
      slide.addText(point.detail, {
        x: 3.42,
        y: y + 0.13,
        w: 5.2,
        h: 0.3,
        margin: 0,
        fontFace: theme.bodyFont,
        fontSize: 9,
        color: theme.muted,
        fit: 'shrink',
      })
    })
    return
  }

  slide.addShape('line', {
    x: 0.82,
    y: 3.18,
    w: 8.36,
    h: 0,
    line: { color: theme.primary, width: 3, transparency: 16 },
  })
  points.forEach((point, itemIndex) => {
    const x = 0.86 + itemIndex * (8.22 / Math.max(points.length - 1, 1))
    const y = itemIndex % 2 === 0 ? 2.26 : 3.62
    slide.addShape('ellipse', {
      x: x - 0.2,
      y: 2.98,
      w: 0.4,
      h: 0.4,
      fill: { color: theme.primary },
      line: { color: theme.accent, transparency: 18, width: 1 },
    })
    slide.addShape('roundRect', {
      x: x - 0.76,
      y,
      w: 1.52,
      h: 0.76,
      rectRadius: 0.08,
      fill: { color: itemIndex % 2 === 0 ? theme.card : theme.primary, transparency: 0 },
      line: { color: theme.secondary, transparency: 38, width: 0.8 },
      shadow: makeShadow(0.08, 6),
    })
    slide.addText(point.heading, {
      x: x - 0.62,
      y: y + 0.12,
      w: 1.24,
      h: 0.16,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 8.2,
      bold: true,
      color: itemIndex % 2 === 0 ? theme.dark : theme.accent,
      align: 'center',
      fit: 'shrink',
    })
    slide.addText(point.detail, {
      x: x - 0.62,
      y: y + 0.36,
      w: 1.24,
      h: 0.22,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 6.6,
      color: itemIndex % 2 === 0 ? theme.muted : theme.secondary,
      align: 'center',
      fit: 'shrink',
    })
  })
}

function renderComparison(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.paper }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'texture')
  addEyebrow(slide, theme, spec.eyebrow || 'COMPARISON')
  addTitle(slide, theme, spec.title, { y: 0.64, w: 6.35, size: 34 })
  const points = getSlidePoints(spec, 4)
  const columns = [
    { x: 0.62, title: '现状 / 挑战', color: theme.secondary, fill: theme.card },
    { x: 5.12, title: '机会 / 方案', color: theme.primary, fill: theme.light },
  ]
  columns.forEach((column, columnIndex) => {
    slide.addShape('roundRect', {
      x: column.x,
      y: 1.5,
      w: 4.0,
      h: 3.12,
      rectRadius: 0.14,
      fill: { color: column.fill },
      line: { color: column.color, transparency: 24, width: 1.1 },
      shadow: makeShadow(0.1, 8),
    })
    slide.addShape('rect', {
      x: column.x,
      y: 1.5,
      w: 0.18,
      h: 3.12,
      fill: { color: column.color },
      line: { color: column.color, transparency: 100 },
    })
    slide.addText(column.title, {
      x: column.x + 0.34,
      y: 1.84,
      w: 3.2,
      h: 0.26,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 15,
      bold: true,
      color: theme.primary,
    })
    points.slice(columnIndex * 2, columnIndex * 2 + 2).forEach((point, itemIndex) => {
      const y = 2.34 + itemIndex * 0.9
      slide.addShape('ellipse', {
        x: column.x + 0.36,
        y,
        w: 0.22,
        h: 0.22,
        fill: { color: column.color },
        line: { color: column.color, transparency: 100 },
      })
      slide.addText(point.heading, {
        x: column.x + 0.72,
        y: y - 0.02,
        w: 2.82,
        h: 0.22,
        margin: 0,
        fontFace: theme.bodyFont,
        fontSize: 11,
        bold: true,
        color: theme.dark,
        fit: 'shrink',
      })
      slide.addText(point.detail, {
        x: column.x + 0.72,
        y: y + 0.28,
        w: 2.86,
        h: 0.34,
        margin: 0,
        fontFace: theme.bodyFont,
        fontSize: 8.5,
        color: theme.muted,
        fit: 'shrink',
      })
    })
  })

  if (spec.slideVariant === 'comparison_matrix') {
    slide.addShape('line', {
      x: 4.84,
      y: 2.1,
      w: 0,
      h: 1.9,
      line: { color: theme.primary, transparency: 38, width: 1.2, beginArrowType: 'none', endArrowType: 'triangle' },
    })
  }
}

function renderDataHighlight(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.primary }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'burst')
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
    fill: { color: theme.primary, transparency: 16 },
    line: { color: theme.primary, transparency: 100 },
  })
  addEyebrow(slide, theme, spec.eyebrow || 'KEY METRICS', true)
  addTitle(slide, theme, spec.title, { y: 0.7, w: 5.8, dark: true, size: 36 })
  const stats = [
    ...(spec.heroMetric ? [spec.heroMetric] : []),
    ...(spec.visual.stats ?? []),
  ].slice(0, 3)
  const safeStats = stats.length
    ? stats
    : [
        { value: `${spec.bullets.length || 3}`, label: '关键抓手' },
        { value: '2x', label: '价值放大' },
        { value: '90d', label: '推进窗口' },
      ]
  safeStats.forEach((stat, itemIndex) => {
    const x = 0.62 + itemIndex * 3.05
    slide.addShape('roundRect', {
      x,
      y: 2.04,
      w: 2.52,
      h: 1.82,
      rectRadius: 0.12,
      fill: { color: 'FFFFFF', transparency: 10 },
      line: { color: theme.secondary, transparency: 62, width: 1 },
      shadow: makeShadow(0.18, 12),
    })
    slide.addText(clip(stat.value, 13), {
      x: x + 0.18,
      y: 2.26,
      w: 2.16,
      h: 0.76,
      margin: 0,
      fontFace: 'Georgia',
      fontSize: 56,
      bold: true,
      color: theme.primary,
      align: 'center',
      fit: 'shrink',
    })
    slide.addText(clip(stat.label, 34), {
      x: x + 0.26,
      y: 3.26,
      w: 2.0,
      h: 0.3,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 11,
      bold: true,
      color: theme.dark,
      align: 'center',
      fit: 'shrink',
    })
  })
}

function chartTypeFor(pptx: PptxInstance, chart: PresentationChartData) {
  if (chart.type === 'line') return pptx.ChartType.line
  if (chart.type === 'pie') return pptx.ChartType.pie
  return pptx.ChartType.bar
}

function renderChart(slide: PptxSlide, pptx: PptxInstance, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.paper }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'mesh')
  addEyebrow(slide, theme, spec.eyebrow || 'DATA VIEW')
  addTitle(slide, theme, spec.title, { y: 0.62, w: 5.8, size: 34 })
  const fallbackLabels = spec.bullets.slice(0, 4).map((item) => item.slice(0, 8)).filter(Boolean)
  const safeFallbackLabels = fallbackLabels.length >= 2 ? fallbackLabels : ['影响程度', '可控性', '落地难度']
  const fallbackChart: PresentationChartData = {
    type: 'bar',
    title: spec.visual.label || '优先级示意，待补充真实数据',
    labels: safeFallbackLabels,
    values: safeFallbackLabels.map((_, itemIndex) => Math.max(2, 4 - itemIndex)),
  }
  const chart = spec.visual.chart && spec.visual.chart.labels.length === spec.visual.chart.values.length
    ? spec.visual.chart
    : fallbackChart
  const points = getSlidePoints(spec, 3)

  slide.addShape('roundRect', {
    x: 0.62,
    y: 1.36,
    w: 5.85,
    h: 3.54,
    rectRadius: 0.14,
    fill: { color: theme.card, transparency: 0 },
    line: { color: theme.secondary, transparency: 48, width: 0.8 },
    shadow: makeShadow(0.1, 8),
  })
  slide.addChart(chartTypeFor(pptx, chart), [{
    name: chart.title || '数据',
    labels: chart.labels,
    values: chart.values,
  }], {
    x: 0.86,
    y: 1.68,
    w: 5.36,
    h: 2.96,
    showTitle: Boolean(chart.title),
    title: chart.title,
    showLegend: false,
    showValue: true,
    chartColors: [theme.primary, theme.secondary, theme.accent],
    valGridLine: { color: 'D6DEE8', size: 0.5 },
    catAxisLabelColor: theme.muted,
    valAxisLabelColor: theme.muted,
  })
  slide.addShape('roundRect', {
    x: 6.9,
    y: 1.52,
    w: 2.32,
    h: 3.08,
    rectRadius: 0.12,
    fill: { color: theme.primary },
    line: { color: theme.primary, transparency: 100 },
    shadow: makeShadow(0.12, 9),
  })
  slide.addText('解读重点', {
    x: 7.12,
    y: 1.78,
    w: 1.86,
    h: 0.2,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 11,
    bold: true,
    color: theme.accent,
  })
  addInsightRows(slide, theme, points, 7.12, 2.18, 1.62, true)
  addHeroMetric(slide, theme, spec, { x: 7.12, y: 3.78, w: 1.8, dark: true })
}

function renderClosing(slide: PptxSlide, theme: PresentationExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.dark }
  addSvgVisual(slide, theme, spec, index, { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, 'orbital')
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 6.68,
    h: SLIDE_HEIGHT,
    fill: { color: theme.dark, transparency: 4 },
    line: { color: theme.dark, transparency: 100 },
  })
  addTitle(slide, theme, spec.title || '谢谢', { x: 0.72, y: 1.28, w: 5.7, h: 0.98, dark: true, size: 42 })
  addSubtitle(slide, theme, spec.subtitle || spec.visual.label || spec.bullets[0], { x: 0.76, y: 2.46, w: 5.1, dark: true, size: 14 })
  const callouts = (spec.callouts?.length ? spec.callouts : spec.bullets).slice(0, 3)
  callouts.forEach((item, itemIndex) => {
    slide.addText(clip(item, 28), {
      x: 0.82,
      y: 3.46 + itemIndex * 0.34,
      w: 4.52,
      h: 0.18,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 10,
      bold: true,
      color: itemIndex === 0 ? theme.accent : theme.secondary,
      fit: 'shrink',
    })
  })
  slide.addShape('roundRect', {
    x: 6.88,
    y: 1.72,
    w: 2.22,
    h: 1.82,
    rectRadius: 0.12,
    fill: { color: theme.primary, transparency: 6 },
    line: { color: theme.secondary, transparency: 52, width: 1 },
    shadow: makeShadow(0.18, 12),
  })
  slide.addText('NEXT', {
    x: 7.24,
    y: 2.14,
    w: 1.48,
    h: 0.34,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: 24,
    bold: true,
    color: theme.accent,
    align: 'center',
  })
  slide.addText('行动建议', {
    x: 7.24,
    y: 2.72,
    w: 1.48,
    h: 0.2,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 10,
    color: theme.secondary,
    align: 'center',
  })
}

function renderSlide(pptx: PptxInstance, deck: PresentationDeckSpec, spec: PresentationSlideSpec, index: number) {
  const slide = pptx.addSlide()
  const theme = getPresentationTheme(deck.themeId)

  if (spec.layout === 'cover') {
    renderCover(slide, theme, deck, spec, index)
  } else if (spec.layout === 'agenda') {
    renderAgenda(slide, theme, spec, deck, index)
  } else if (spec.layout === 'section') {
    renderSection(slide, theme, spec, index)
  } else if (spec.layout === 'cards') {
    renderCards(slide, theme, spec, index)
  } else if (spec.layout === 'two_column') {
    renderTwoColumn(slide, theme, spec, index)
  } else if (spec.layout === 'timeline') {
    renderTimeline(slide, theme, spec, index)
  } else if (spec.layout === 'comparison') {
    renderComparison(slide, theme, spec, index)
  } else if (spec.layout === 'data_highlight') {
    renderDataHighlight(slide, theme, spec, index)
  } else if (spec.layout === 'chart') {
    renderChart(slide, pptx, theme, spec, index)
  } else {
    renderClosing(slide, theme, spec, index)
  }

  if (spec.layout !== 'cover') {
    const isDark = spec.layout === 'section' || spec.layout === 'data_highlight' || spec.layout === 'closing'
    addPageNumber(slide, theme, index, deck.slides.length, isDark)
    addCornerLabel(slide, theme, deck.motif || deck.deckStyle?.motif || theme.motif, isDark)
  }
  addSlideNotes(slide, spec)
}

function buildPresentationPptx(deck: PresentationDeckSpec) {
  const pptx = new pptxgen()
  const theme = getPresentationTheme(deck.themeId)
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'KatopGPT'
  pptx.company = 'KatopGPT'
  pptx.subject = deck.goal ?? deck.title
  pptx.title = deck.title
  pptx.theme = {
    headFontFace: theme.titleFont,
    bodyFontFace: theme.bodyFont,
  }

  deck.slides.forEach((slide, index) => renderSlide(pptx, deck, slide, index))
  return pptx
}

async function writePresentationDeckToFile(deck: PresentationDeckSpec, filePath: string) {
  const pptx = buildPresentationPptx(deck)
  await pptx.writeFile({ fileName: filePath })
}

async function createTemporaryDeckFile(deck: PresentationDeckSpec) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katopgpt-pptx-'))
  const filePath = path.join(tempDir, `${safeFileName(deck.title)}.pptx`)
  await writePresentationDeckToFile(deck, filePath)
  return { tempDir, filePath }
}

function parsePresentationDeck(deck: PresentationDeckSpec) {
  const parsed = presentationDeckSpecSchema.safeParse(deck)
  if (!parsed.success) {
    throw new Error(`PPT 结构无效：${parsed.error.issues[0]?.message ?? '未知错误'}`)
  }
  return parsed.data
}

export async function previewPresentationDeck(request: PresentationPreviewRequest): Promise<PresentationPreviewResult> {
  let tempDeck: Awaited<ReturnType<typeof createTemporaryDeckFile>> | null = null
  try {
    const deck = parsePresentationDeck(request.deck)
    const issues = auditPresentationDeckSpec(deck)
    const blockingIssues = issues.filter((issue) => issue.severity === 'error')
    if (blockingIssues.length > 0) {
      return {
        ok: false,
        message: `PPT 结构还有 ${blockingIssues.length} 个阻塞问题，请先修复后再生成真实预览。`,
        issues,
      }
    }

    const tools = await checkPresentationRenderTools()
    if (!tools.ok) {
      return {
        ok: false,
        message: tools.message,
        issues,
      }
    }

    tempDeck = await createTemporaryDeckFile(deck)
    const slides = await renderPresentationPreviewImages(tempDeck.filePath)
    return {
      ok: true,
      message: `已生成 ${slides.length} 张真实预览图。`,
      slides,
      issues,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '生成真实预览失败。',
    }
  } finally {
    if (tempDeck) {
      await removePresentationTempDirectory(tempDeck.tempDir)
    }
  }
}

export async function exportPresentationDeckToFile(
  request: PresentationExportRequest,
  ownerWindow?: BrowserWindow | null
): Promise<PresentationExportResult> {
  let tempDeck: Awaited<ReturnType<typeof createTemporaryDeckFile>> | null = null
  try {
    const deck = parsePresentationDeck(request.deck)
    const issues = auditPresentationDeckSpec(deck)
    const blockingIssues = issues.filter((issue) => issue.severity === 'error')
    if (blockingIssues.length > 0) {
      return {
        ok: false,
        message: `PPT 结构还有 ${blockingIssues.length} 个阻塞问题，请先修复后再导出。`,
      }
    }

    const tools = await checkPresentationRenderTools()
    if (!tools.ok) {
      return {
        ok: false,
        message: tools.message,
      }
    }

    tempDeck = await createTemporaryDeckFile(deck)
    await renderPresentationPreviewImages(tempDeck.filePath)

    const defaultPath = path.join(app.getPath('documents'), `${safeFileName(deck.title)}.pptx`)
    const dialogOptions = {
      title: '导出 PPTX',
      defaultPath,
      filters: [
        { name: 'PowerPoint 演示文稿', extensions: ['pptx'] },
      ],
    }
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        message: '已取消导出。',
      }
    }

    const finalPath = withPptxExtension(result.filePath)
    await fs.copyFile(tempDeck.filePath, finalPath)

    return {
      ok: true,
      message: `已导出 PPTX：${finalPath}`,
      filePath: finalPath,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '导出 PPTX 失败。',
    }
  } finally {
    if (tempDeck) {
      await removePresentationTempDirectory(tempDeck.tempDir)
    }
  }
}
