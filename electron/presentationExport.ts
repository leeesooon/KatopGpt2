import type { BrowserWindow } from 'electron'
import { app, dialog } from 'electron'
import path from 'path'
import pptxgen from 'pptxgenjs'
import {
  presentationDeckSpecSchema,
  type PresentationChartData,
  type PresentationDeckSpec,
  type PresentationExportRequest,
  type PresentationExportResult,
  type PresentationSlideSpec,
  type PresentationThemeId,
} from './shared/presentation'

interface ExportTheme {
  id: PresentationThemeId
  name: string
  primary: string
  secondary: string
  accent: string
  dark: string
  light: string
  paper: string
  muted: string
  titleFont: string
  bodyFont: string
}

const SLIDE_WIDTH = 10
const SLIDE_HEIGHT = 5.625
const SAFE_MARGIN = 0.5

const THEMES: Record<PresentationThemeId, ExportTheme> = {
  'executive-midnight': {
    id: 'executive-midnight',
    name: 'Midnight Executive',
    primary: '1E2761',
    secondary: 'CADCFC',
    accent: 'FFFFFF',
    dark: '12172F',
    light: 'F4F7FF',
    paper: 'F8FAFF',
    muted: '66739A',
    titleFont: 'Microsoft YaHei UI',
    bodyFont: 'DengXian',
  },
  'warm-terra': {
    id: 'warm-terra',
    name: 'Warm Terracotta',
    primary: 'B85042',
    secondary: 'E7E8D1',
    accent: 'A7BEAE',
    dark: '3C241E',
    light: 'FFF7ED',
    paper: 'FBF4E8',
    muted: '876B5C',
    titleFont: 'Georgia',
    bodyFont: 'Microsoft YaHei UI',
  },
  'teal-trust': {
    id: 'teal-trust',
    name: 'Teal Trust',
    primary: '028090',
    secondary: '00A896',
    accent: '02C39A',
    dark: '073B4C',
    light: 'E6FFFA',
    paper: 'F0FDFA',
    muted: '42747A',
    titleFont: 'Trebuchet MS',
    bodyFont: 'Microsoft YaHei UI',
  },
}

type PptxInstance = InstanceType<typeof pptxgen>
type PptxSlide = ReturnType<PptxInstance['addSlide']>

function makeShadow(opacity = 0.14) {
  return { type: 'outer' as const, color: '000000', blur: 7, offset: 2, angle: 135, opacity }
}

function safeFileName(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return sanitized || `KatopGPT-PPT-${Date.now()}`
}

function clip(value: string | undefined, maxChars: number) {
  if (!value) return ''
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`
}

function getTheme(themeId: PresentationThemeId) {
  return THEMES[themeId] ?? THEMES['executive-midnight']
}

function addSlideNotes(slide: PptxSlide, spec: PresentationSlideSpec) {
  if (!spec.speakerNotes?.trim()) return
  slide.addNotes(spec.speakerNotes.trim())
}

function addPageNumber(slide: PptxSlide, theme: ExportTheme, index: number, total: number, isDark = false) {
  slide.addText(`${index + 1}/${total}`, {
    x: 8.9,
    y: 5.08,
    w: 0.62,
    h: 0.18,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    color: isDark ? theme.secondary : theme.muted,
    align: 'right',
  })
}

function addEyebrow(slide: PptxSlide, theme: ExportTheme, text: string | undefined, isDark = false) {
  if (!text) return
  slide.addText(clip(text, 24).toUpperCase(), {
    x: SAFE_MARGIN,
    y: 0.36,
    w: 3.8,
    h: 0.22,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    charSpacing: 1.5,
    color: isDark ? theme.secondary : theme.primary,
  })
}

function addTitle(slide: PptxSlide, theme: ExportTheme, title: string, opts: { x?: number; y?: number; w?: number; h?: number; dark?: boolean } = {}) {
  slide.addText(clip(title, 42), {
    x: opts.x ?? SAFE_MARGIN,
    y: opts.y ?? 0.78,
    w: opts.w ?? 5.8,
    h: opts.h ?? 0.62,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: 30,
    bold: true,
    color: opts.dark ? theme.accent : theme.dark,
    fit: 'shrink',
    breakLine: false,
  })
}

function addSubtitle(slide: PptxSlide, theme: ExportTheme, subtitle: string | undefined, opts: { x?: number; y?: number; w?: number; dark?: boolean } = {}) {
  if (!subtitle) return
  slide.addText(clip(subtitle, 82), {
    x: opts.x ?? SAFE_MARGIN,
    y: opts.y ?? 1.58,
    w: opts.w ?? 5.5,
    h: 0.55,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 13,
    color: opts.dark ? theme.secondary : theme.muted,
    fit: 'shrink',
    breakLine: false,
  })
}

function addBulletList(slide: PptxSlide, theme: ExportTheme, bullets: string[], x: number, y: number, w: number, h: number, isDark = false) {
  const textRuns = bullets.slice(0, 5).map((bullet, index) => ({
    text: clip(bullet, 50),
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
    fontSize: 13,
    color: isDark ? theme.light : theme.dark,
    margin: [2, 6, 2, 8],
    fit: 'shrink',
    breakLine: true,
  })
}

function addMotif(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, isDark = false) {
  slide.addShape(pptx.ShapeType.arc, {
    x: 7.08,
    y: -0.58,
    w: 3.15,
    h: 3.15,
    rotate: 18,
    line: { color: isDark ? theme.secondary : theme.accent, transparency: 18, width: 2 },
  })
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 8.3,
    y: 0.48,
    w: 0.62,
    h: 0.62,
    fill: { color: isDark ? theme.secondary : theme.accent, transparency: 14 },
    line: { color: isDark ? theme.secondary : theme.accent, transparency: 100 },
  })
}

function renderCover(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, deck: PresentationDeckSpec, spec: PresentationSlideSpec) {
  slide.background = { color: theme.dark }
  addMotif(slide, pptx, theme, true)
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: SLIDE_HEIGHT,
    fill: { color: theme.secondary, transparency: 4 },
    line: { color: theme.secondary, transparency: 100 },
  })
  slide.addText(theme.name, {
    x: SAFE_MARGIN,
    y: 0.58,
    w: 3.2,
    h: 0.22,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 8,
    bold: true,
    charSpacing: 2.2,
    color: theme.secondary,
  })
  addTitle(slide, theme, spec.title || deck.title, { y: 1.48, w: 6.1, h: 1.2, dark: true })
  addSubtitle(slide, theme, spec.subtitle || deck.subtitle || deck.goal, { y: 2.84, w: 5.8, dark: true })
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.75,
    y: 1.42,
    w: 2.35,
    h: 2.55,
    rectRadius: 0.09,
    fill: { color: theme.primary, transparency: 6 },
    line: { color: theme.secondary, transparency: 62, width: 1 },
    shadow: makeShadow(0.22),
  })
  slide.addText(clip(spec.visual.label || 'STRUCTURE', 22), {
    x: 7.06,
    y: 2.02,
    w: 1.72,
    h: 0.4,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: 18,
    bold: true,
    color: theme.accent,
    align: 'center',
  })
  slide.addText(`${deck.slides.length} 页`, {
    x: 7.3,
    y: 2.64,
    w: 1.22,
    h: 0.36,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 13,
    color: theme.secondary,
    align: 'center',
  })
}

function renderAgenda(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec, deck: PresentationDeckSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow || 'AGENDA')
  addTitle(slide, theme, spec.title, { y: 0.72, w: 4.8 })
  const agendaItems = (spec.visual.items?.length ? spec.visual.items : deck.slides.slice(1, 6).map((item) => item.title)).slice(0, 5)
  agendaItems.forEach((item, index) => {
    const y = 1.58 + index * 0.66
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.56,
      y,
      w: 8.65,
      h: 0.46,
      rectRadius: 0.05,
      fill: { color: index % 2 === 0 ? theme.light : 'FFFFFF', transparency: 0 },
      line: { color: theme.secondary, transparency: 50, width: 0.7 },
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.76,
      y: y + 0.1,
      w: 0.26,
      h: 0.26,
      fill: { color: theme.primary },
      line: { color: theme.primary, transparency: 100 },
    })
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: 0.72,
      y: y + 0.13,
      w: 0.35,
      h: 0.12,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 6.5,
      bold: true,
      color: theme.accent,
      align: 'center',
    })
    slide.addText(clip(item, 42), {
      x: 1.18,
      y: y + 0.1,
      w: 7.55,
      h: 0.22,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 12,
      bold: true,
      color: theme.dark,
      fit: 'shrink',
    })
  })
}

function renderSection(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec, index: number) {
  slide.background = { color: theme.primary }
  addMotif(slide, pptx, theme, true)
  slide.addText(String(index + 1).padStart(2, '0'), {
    x: 0.52,
    y: 0.68,
    w: 1.1,
    h: 0.78,
    margin: 0,
    fontFace: 'Georgia',
    fontSize: 40,
    bold: true,
    color: theme.secondary,
  })
  addTitle(slide, theme, spec.title, { x: 0.56, y: 1.76, w: 6.3, h: 0.9, dark: true })
  addSubtitle(slide, theme, spec.subtitle || spec.visual.label, { x: 0.58, y: 2.78, w: 5.8, dark: true })
  addBulletList(slide, theme, spec.bullets.slice(0, 3), 6.55, 1.52, 2.5, 2.1, true)
}

function renderCards(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow || spec.visual.label)
  addTitle(slide, theme, spec.title, { y: 0.68, w: 6.2 })
  const items = (spec.visual.items?.length ? spec.visual.items : spec.bullets).slice(0, 4)
  items.forEach((item, index) => {
    const x = 0.58 + (index % 2) * 4.45
    const y = 1.58 + Math.floor(index / 2) * 1.45
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w: 3.95,
      h: 1.03,
      fill: { color: index % 2 === 0 ? 'FFFFFF' : theme.light },
      line: { color: theme.secondary, transparency: 46, width: 0.75 },
      shadow: makeShadow(0.08),
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.24,
      y: y + 0.24,
      w: 0.42,
      h: 0.42,
      fill: { color: theme.primary },
      line: { color: theme.primary, transparency: 100 },
    })
    slide.addText(String(index + 1), {
      x: x + 0.24,
      y: y + 0.34,
      w: 0.42,
      h: 0.12,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 8,
      bold: true,
      align: 'center',
      color: theme.accent,
    })
    slide.addText(clip(item, 48), {
      x: x + 0.86,
      y: y + 0.26,
      w: 2.75,
      h: 0.42,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 12,
      bold: true,
      color: theme.dark,
      fit: 'shrink',
    })
  })
}

function renderTwoColumn(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow)
  addTitle(slide, theme, spec.title, { y: 0.66, w: 5.8 })
  addBulletList(slide, theme, spec.bullets, 0.58, 1.62, 4.22, 3.0)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.55,
    y: 1.12,
    w: 3.85,
    h: 3.45,
    rectRadius: 0.1,
    fill: { color: theme.primary },
    line: { color: theme.primary, transparency: 100 },
    shadow: makeShadow(0.14),
  })
  slide.addText(clip(spec.visual.label || '核心结构', 34), {
    x: 5.98,
    y: 1.64,
    w: 3.0,
    h: 0.56,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: 20,
    bold: true,
    color: theme.accent,
    fit: 'shrink',
  })
  ;(spec.visual.items ?? spec.bullets).slice(0, 3).forEach((item, index) => {
    slide.addText(clip(item, 30), {
      x: 6.02,
      y: 2.38 + index * 0.47,
      w: 2.82,
      h: 0.2,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 10,
      color: theme.light,
      fit: 'shrink',
    })
  })
}

function renderTimeline(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow || 'ROADMAP')
  addTitle(slide, theme, spec.title, { y: 0.68, w: 6.2 })
  const items = (spec.visual.items?.length ? spec.visual.items : spec.bullets).slice(0, 5)
  slide.addShape(pptx.ShapeType.line, {
    x: 0.92,
    y: 3,
    w: 8.15,
    h: 0,
    line: { color: theme.secondary, width: 2 },
  })
  items.forEach((item, index) => {
    const x = 0.82 + index * (8.05 / Math.max(items.length - 1, 1))
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x - 0.13,
      y: 2.86,
      w: 0.32,
      h: 0.32,
      fill: { color: theme.primary },
      line: { color: theme.primary, transparency: 100 },
    })
    slide.addText(`0${index + 1}`, {
      x: x - 0.32,
      y: 2.2,
      w: 0.72,
      h: 0.22,
      margin: 0,
      fontFace: theme.titleFont,
      fontSize: 13,
      bold: true,
      color: theme.primary,
      align: 'center',
    })
    slide.addText(clip(item, 24), {
      x: x - 0.62,
      y: 3.34,
      w: 1.35,
      h: 0.58,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 9,
      color: theme.dark,
      align: 'center',
      fit: 'shrink',
    })
  })
}

function renderComparison(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow || 'COMPARISON')
  addTitle(slide, theme, spec.title, { y: 0.68, w: 6.2 })
  const items = (spec.visual.items?.length ? spec.visual.items : spec.bullets).slice(0, 4)
  const columns = [
    { x: 0.64, title: '现状 / 挑战', color: theme.secondary },
    { x: 5.12, title: '方案 / 机会', color: theme.accent },
  ]
  columns.forEach((column, columnIndex) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: column.x,
      y: 1.54,
      w: 4.0,
      h: 3.05,
      fill: { color: columnIndex === 0 ? 'FFFFFF' : theme.light },
      line: { color: column.color, transparency: 28, width: 1 },
      shadow: makeShadow(0.08),
    })
    slide.addText(column.title, {
      x: column.x + 0.3,
      y: 1.86,
      w: 3.25,
      h: 0.25,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 14,
      bold: true,
      color: theme.primary,
    })
    addBulletList(slide, theme, items.slice(columnIndex * 2, columnIndex * 2 + 2), column.x + 0.28, 2.4, 3.28, 1.36)
  })
}

function renderDataHighlight(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.primary }
  addEyebrow(slide, theme, spec.eyebrow || 'KEY METRICS', true)
  addTitle(slide, theme, spec.title, { y: 0.72, w: 5.8, dark: true })
  const stats = spec.visual.stats?.length
    ? spec.visual.stats.slice(0, 3)
    : [
        { value: `${spec.bullets.length || 3}`, label: '关键抓手' },
        { value: '2x', label: '价值放大' },
        { value: '90d', label: '推进窗口' },
      ]
  stats.forEach((stat, index) => {
    const x = 0.7 + index * 3.05
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.18,
      w: 2.44,
      h: 1.52,
      rectRadius: 0.08,
      fill: { color: 'FFFFFF', transparency: 8 },
      line: { color: theme.secondary, transparency: 68, width: 1 },
    })
    slide.addText(clip(stat.value, 12), {
      x: x + 0.22,
      y: 2.48,
      w: 1.98,
      h: 0.42,
      margin: 0,
      fontFace: 'Georgia',
      fontSize: 28,
      bold: true,
      color: theme.accent,
      align: 'center',
      fit: 'shrink',
    })
    slide.addText(clip(stat.label, 32), {
      x: x + 0.28,
      y: 3.16,
      w: 1.88,
      h: 0.24,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 10,
      color: theme.light,
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

function renderChart(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.paper }
  addEyebrow(slide, theme, spec.eyebrow || 'DATA VIEW')
  addTitle(slide, theme, spec.title, { y: 0.62, w: 5.8 })
  const fallbackLabels = spec.bullets.slice(0, 4).map((item) => item.slice(0, 8)).filter(Boolean)
  const safeFallbackLabels = fallbackLabels.length >= 2 ? fallbackLabels : ['维度 A', '维度 B', '维度 C']
  const fallbackChart: PresentationChartData = {
    type: 'bar',
    title: spec.visual.label || '关键维度对比',
    labels: safeFallbackLabels,
    values: safeFallbackLabels.map((_, index) => 70 - index * 10),
  }
  const chart = spec.visual.chart && spec.visual.chart.labels.length === spec.visual.chart.values.length
    ? spec.visual.chart
    : fallbackChart

  slide.addChart(chartTypeFor(pptx, chart), [{
    name: chart.title || '数据',
    labels: chart.labels,
    values: chart.values,
  }], {
    x: 0.72,
    y: 1.45,
    w: 5.7,
    h: 3.36,
    showTitle: Boolean(chart.title),
    title: chart.title,
    showLegend: false,
    showValue: true,
    chartColors: [theme.primary, theme.secondary, theme.accent],
    valGridLine: { color: 'D6DEE8', size: 0.5 },
    catAxisLabelColor: theme.muted,
    valAxisLabelColor: theme.muted,
  })
  addBulletList(slide, theme, spec.bullets.slice(0, 3), 6.85, 1.62, 2.34, 2.55)
}

function renderClosing(slide: PptxSlide, pptx: PptxInstance, theme: ExportTheme, spec: PresentationSlideSpec) {
  slide.background = { color: theme.dark }
  addMotif(slide, pptx, theme, true)
  addTitle(slide, theme, spec.title || '谢谢', { x: 0.72, y: 1.42, w: 5.8, h: 0.9, dark: true })
  addSubtitle(slide, theme, spec.subtitle || spec.visual.label || spec.bullets[0], { x: 0.76, y: 2.44, w: 5.2, dark: true })
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.78,
    y: 1.62,
    w: 2.3,
    h: 1.78,
    rectRadius: 0.08,
    fill: { color: theme.primary, transparency: 10 },
    line: { color: theme.secondary, transparency: 62, width: 1 },
  })
  slide.addText('NEXT', {
    x: 7.22,
    y: 2.05,
    w: 1.38,
    h: 0.34,
    margin: 0,
    fontFace: theme.titleFont,
    fontSize: 21,
    bold: true,
    color: theme.accent,
    align: 'center',
  })
  slide.addText('行动建议', {
    x: 7.22,
    y: 2.58,
    w: 1.38,
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
  const theme = getTheme(deck.themeId)

  if (spec.layout === 'cover') {
    renderCover(slide, pptx, theme, deck, spec)
  } else if (spec.layout === 'agenda') {
    renderAgenda(slide, pptx, theme, spec, deck)
  } else if (spec.layout === 'section') {
    renderSection(slide, pptx, theme, spec, index)
  } else if (spec.layout === 'cards') {
    renderCards(slide, pptx, theme, spec)
  } else if (spec.layout === 'two_column') {
    renderTwoColumn(slide, pptx, theme, spec)
  } else if (spec.layout === 'timeline') {
    renderTimeline(slide, pptx, theme, spec)
  } else if (spec.layout === 'comparison') {
    renderComparison(slide, pptx, theme, spec)
  } else if (spec.layout === 'data_highlight') {
    renderDataHighlight(slide, pptx, theme, spec)
  } else if (spec.layout === 'chart') {
    renderChart(slide, pptx, theme, spec)
  } else {
    renderClosing(slide, pptx, theme, spec)
  }

  if (spec.layout !== 'cover') {
    addPageNumber(slide, theme, index, deck.slides.length, spec.layout === 'section' || spec.layout === 'data_highlight' || spec.layout === 'closing')
  }
  addSlideNotes(slide, spec)
}

export async function exportPresentationDeckToFile(
  request: PresentationExportRequest,
  ownerWindow?: BrowserWindow | null
): Promise<PresentationExportResult> {
  try {
    const parsed = presentationDeckSpecSchema.safeParse(request.deck)
    if (!parsed.success) {
      return {
        ok: false,
        message: `PPT 结构无效：${parsed.error.issues[0]?.message ?? '未知错误'}`,
      }
    }

    const deck = parsed.data
    const pptx = new pptxgen()
    const theme = getTheme(deck.themeId)
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

    await pptx.writeFile({ fileName: result.filePath })

    return {
      ok: true,
      message: `已导出 PPTX：${result.filePath}`,
      filePath: result.filePath,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '导出 PPTX 失败',
    }
  }
}
