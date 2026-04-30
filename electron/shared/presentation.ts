import { z } from 'zod'

export const PRESENTATION_THEME_IDS = [
  'executive-midnight',
  'warm-terra',
  'teal-trust',
  'forest-moss',
  'coral-energy',
  'charcoal-minimal',
  'berry-cream',
] as const

export const PRESENTATION_SLIDE_LAYOUTS = [
  'cover',
  'agenda',
  'section',
  'cards',
  'two_column',
  'timeline',
  'comparison',
  'data_highlight',
  'chart',
  'closing',
] as const

export const PRESENTATION_VISUAL_TYPES = [
  'shape',
  'icon_grid',
  'stat',
  'chart',
  'timeline',
  'comparison',
] as const

export const PRESENTATION_SLIDE_VARIANTS = [
  'cover_poster',
  'split_hero',
  'angled_panel',
  'metric_wall',
  'process_ribbon',
  'card_grid',
  'comparison_matrix',
  'architecture_map',
  'editorial_close',
] as const

export const PRESENTATION_SVG_VISUAL_TYPES = [
  'orbital',
  'mesh',
  'process',
  'network',
  'architecture',
  'radar',
  'burst',
  'texture',
] as const

export const PRESENTATION_CHART_TYPES = [
  'bar',
  'line',
  'pie',
] as const

export type PresentationThemeId = typeof PRESENTATION_THEME_IDS[number]
export type PresentationSlideLayout = typeof PRESENTATION_SLIDE_LAYOUTS[number]
export type PresentationVisualType = typeof PRESENTATION_VISUAL_TYPES[number]
export type PresentationSlideVariant = typeof PRESENTATION_SLIDE_VARIANTS[number]
export type PresentationSvgVisualType = typeof PRESENTATION_SVG_VISUAL_TYPES[number]
export type PresentationChartType = typeof PRESENTATION_CHART_TYPES[number]
export type PresentationDeckDensity = 'calm' | 'balanced' | 'dense'
export type PresentationPageStrategy = 'mostly-light' | 'mixed' | 'dark-led'
export type PresentationSvgEmphasis = 'background' | 'hero' | 'diagram' | 'texture'
export type PresentationRenderToolName = 'soffice' | 'pdftoppm'

export interface PresentationStat {
  value: string
  label: string
}

export interface PresentationChartData {
  type: PresentationChartType
  title?: string
  labels: string[]
  values: number[]
}

export interface PresentationVisualSpec {
  type: PresentationVisualType
  label?: string
  items?: string[]
  stats?: PresentationStat[]
  chart?: PresentationChartData
}

export interface PresentationDeckStyle {
  tone?: string
  density?: PresentationDeckDensity
  pageStrategy?: PresentationPageStrategy
  motif?: string
}

export interface PresentationSvgVisualSpec {
  kind: PresentationSvgVisualType
  label?: string
  emphasis?: PresentationSvgEmphasis
  seed?: number
}

export interface PresentationSlideSpec {
  id: string
  layout: PresentationSlideLayout
  slideVariant?: PresentationSlideVariant
  title: string
  subtitle?: string
  eyebrow?: string
  bullets: string[]
  speakerNotes?: string
  visual: PresentationVisualSpec
  svgVisual?: PresentationSvgVisualSpec
  heroMetric?: PresentationStat
  callouts?: string[]
  visualFocus?: string
}

export interface PresentationDeckSpec {
  title: string
  subtitle?: string
  audience?: string
  goal?: string
  themeId: PresentationThemeId
  deckStyle?: PresentationDeckStyle
  palette?: string[]
  motif?: string
  slides: PresentationSlideSpec[]
}

export interface PresentationExportRequest {
  deck: PresentationDeckSpec
}

export interface PresentationExportResult {
  ok: boolean
  message: string
  filePath?: string
}

export interface PresentationPreviewRequest {
  deck: PresentationDeckSpec
}

export interface PresentationPreviewSlide {
  index: number
  dataUrl: string
}

export interface PresentationPreviewResult {
  ok: boolean
  message: string
  slides?: PresentationPreviewSlide[]
  issues?: PresentationQaIssue[]
}

export interface PresentationCodeAsset {
  id: string
  name: string
  fileType?: 'text' | 'pdf' | 'pptx' | 'docx' | 'xlsx' | 'csv'
  content: string
}

export interface PresentationCodeRequest {
  topic: string
  audience?: string
  goal?: string
  slideCount: number
  themeId: PresentationThemeId
  files: PresentationCodeAsset[]
}

export interface PresentationCodeArtifact {
  title: string
  code: string
  notes?: string
  trustedNodeExecution?: boolean
}

export interface PresentationCodeRunRequest {
  input: PresentationCodeRequest
  artifact: PresentationCodeArtifact
}

export type PresentationCodeDiagnosticLevel = 'info' | 'warning' | 'error'

export interface PresentationCodeDiagnostic {
  level: PresentationCodeDiagnosticLevel
  message: string
}

export interface PresentationCodeRunResult {
  ok: boolean
  message: string
  sessionId?: string
  slides?: PresentationPreviewSlide[]
  diagnostics?: PresentationCodeDiagnostic[]
  errorMessage?: string
  stdout?: string
  stderr?: string
}

export interface PresentationCodeExportRequest {
  sessionId: string
  title: string
}

export interface PresentationCodeExportResult {
  ok: boolean
  message: string
  filePath?: string
}

export interface PresentationRenderToolsStatus {
  ok: boolean
  missing: PresentationRenderToolName[]
  message: string
  sofficePath?: string
  pdftoppmPath?: string
}

export interface PresentationInstallRenderToolsResult {
  ok: boolean
  message: string
  started?: boolean
  logPath?: string
  status?: PresentationRenderToolsStatus
}

export type PresentationQaSeverity = 'warning' | 'error'

export interface PresentationQaIssue {
  severity: PresentationQaSeverity
  slideIndex?: number
  message: string
}

const nonEmptyStringSchema = z.string().trim().min(1)
const MIN_CONTENT_SLIDE_CHARS = 120
const MIN_CONTENT_SLIDE_POINTS = 3
const MIN_MEANINGFUL_POINT_CHARS = 12

export const presentationStatSchema = z.object({
  value: nonEmptyStringSchema.max(18),
  label: nonEmptyStringSchema.max(40),
})

export const presentationChartDataSchema = z.object({
  type: z.enum(PRESENTATION_CHART_TYPES),
  title: z.string().trim().max(48).optional(),
  labels: z.array(nonEmptyStringSchema.max(24)).min(2).max(8),
  values: z.array(z.number().finite()).min(2).max(8),
}).refine((chart) => chart.labels.length === chart.values.length, {
  message: '图表标签和数值数量必须一致',
})

export const presentationVisualSpecSchema = z.object({
  type: z.enum(PRESENTATION_VISUAL_TYPES),
  label: z.string().trim().max(60).optional(),
  items: z.array(nonEmptyStringSchema.max(42)).max(6).optional(),
  stats: z.array(presentationStatSchema).max(4).optional(),
  chart: presentationChartDataSchema.optional(),
})

export const presentationDeckStyleSchema = z.object({
  tone: z.string().trim().max(44).optional(),
  density: z.enum(['calm', 'balanced', 'dense']).optional(),
  pageStrategy: z.enum(['mostly-light', 'mixed', 'dark-led']).optional(),
  motif: z.string().trim().max(48).optional(),
})

export const presentationSvgVisualSpecSchema = z.object({
  kind: z.enum(PRESENTATION_SVG_VISUAL_TYPES),
  label: z.string().trim().max(60).optional(),
  emphasis: z.enum(['background', 'hero', 'diagram', 'texture']).optional(),
  seed: z.number().int().min(0).max(9999).optional(),
})

export const presentationSlideSpecSchema = z.object({
  id: nonEmptyStringSchema.max(64),
  layout: z.enum(PRESENTATION_SLIDE_LAYOUTS),
  slideVariant: z.enum(PRESENTATION_SLIDE_VARIANTS).optional(),
  title: nonEmptyStringSchema.max(52),
  subtitle: z.string().trim().max(90).optional(),
  eyebrow: z.string().trim().max(28).optional(),
  bullets: z.array(nonEmptyStringSchema.max(56)).max(6).default([]),
  speakerNotes: z.string().trim().max(600).optional(),
  visual: presentationVisualSpecSchema,
  svgVisual: presentationSvgVisualSpecSchema.optional(),
  heroMetric: presentationStatSchema.optional(),
  callouts: z.array(nonEmptyStringSchema.max(42)).max(4).optional(),
  visualFocus: z.string().trim().max(72).optional(),
})

export const presentationDeckSpecSchema = z.object({
  title: nonEmptyStringSchema.max(72),
  subtitle: z.string().trim().max(120).optional(),
  audience: z.string().trim().max(80).optional(),
  goal: z.string().trim().max(120).optional(),
  themeId: z.enum(PRESENTATION_THEME_IDS),
  deckStyle: presentationDeckStyleSchema.optional(),
  palette: z.array(z.string().trim().regex(/^#?[0-9a-f]{6}$/i, '颜色必须是 6 位 hex')).min(3).max(8).optional(),
  motif: z.string().trim().max(48).optional(),
  slides: z.array(presentationSlideSpecSchema).min(3).max(20),
})

function hasVisualPayload(visual: PresentationVisualSpec) {
  if (visual.type === 'chart') {
    return Boolean(visual.chart?.labels.length && visual.chart.values.length)
  }
  if (visual.type === 'stat') {
    return Boolean(visual.stats?.length)
  }
  return Boolean(visual.label || visual.items?.length || visual.stats?.length || visual.chart)
}

function normalizeAuditText(value: string) {
  return value.replace(/\s+/g, '').trim()
}

function isShortAuditLabel(value: string) {
  const compact = normalizeAuditText(value).replace(/[，。；：、:：/／\-\s]/g, '')
  return compact.length > 0 && compact.length <= 8
}

function isMeaningfulAuditPoint(value: string) {
  const text = normalizeAuditText(value)
  if (text.length < MIN_MEANINGFUL_POINT_CHARS) return false
  if (/[，。；：、:]/.test(value)) return true
  return /(需要|建议|通过|围绕|聚焦|明确|推动|提升|降低|建立|形成|拆解|复盘|落地|验证|优先|转化|沉淀)/.test(value)
}

function getSlideVisibleText(slide: PresentationSlideSpec) {
  return [
    slide.title,
    slide.subtitle,
    ...slide.bullets,
    slide.visual.label,
    ...(slide.visual.items ?? []),
    ...(slide.visual.stats ?? []).flatMap((stat) => [stat.value, stat.label]),
    slide.visual.chart?.title,
    ...(slide.visual.chart?.labels ?? []),
    ...(slide.callouts ?? []),
    slide.visualFocus,
  ].filter((item): item is string => Boolean(item)).join('')
}

function getSlidePointCandidates(slide: PresentationSlideSpec) {
  return [
    ...slide.bullets,
    ...(slide.visual.items ?? []),
    ...(slide.callouts ?? []),
  ].filter((item): item is string => Boolean(item))
}

function isContentSlide(layout: PresentationSlideLayout) {
  return layout !== 'cover' && layout !== 'closing' && layout !== 'agenda'
}

export function auditPresentationDeckSpec(deck: PresentationDeckSpec): PresentationQaIssue[] {
  const issues: PresentationQaIssue[] = []
  const layoutRuns: Array<{ layout: PresentationSlideLayout; count: number; start: number }> = []
  const variantRuns: Array<{ variant: PresentationSlideVariant; count: number; start: number }> = []

  deck.slides.forEach((slide, index) => {
    if (!slide.title.trim()) {
      issues.push({ severity: 'error', slideIndex: index, message: '页面标题不能为空。' })
    }
    if (slide.title.length > 42) {
      issues.push({ severity: 'warning', slideIndex: index, message: '页面标题偏长，导出后可能换行。' })
    }
    if (slide.bullets.length > 5) {
      issues.push({ severity: 'warning', slideIndex: index, message: '要点超过 5 条，建议压缩。' })
    }
    const denseBullets = slide.bullets.filter((bullet) => bullet.length > 44)
    if (denseBullets.length > 1) {
      issues.push({ severity: 'warning', slideIndex: index, message: '页面要点文本偏密，建议缩短。' })
    }
    if (!hasVisualPayload(slide.visual) && !slide.svgVisual && !slide.heroMetric && !slide.callouts?.length) {
      issues.push({ severity: 'error', slideIndex: index, message: '页面缺少视觉元素。' })
    }
    if (!slide.svgVisual && !slide.heroMetric && !slide.callouts?.length && !slide.visual.label) {
      issues.push({ severity: 'warning', slideIndex: index, message: '页面缺少明确视觉焦点，建议补充 SVG 视觉、核心数字或标注。' })
    }
    if (slide.layout === 'chart' && (!slide.visual.chart || slide.visual.chart.labels.length < 2)) {
      issues.push({ severity: 'error', slideIndex: index, message: '图表页缺少可渲染的数据。' })
    }
    if (slide.layout === 'data_highlight' && !slide.heroMetric && !slide.visual.stats?.length) {
      issues.push({ severity: 'warning', slideIndex: index, message: '数据强调页建议提供 heroMetric 或 stats。' })
    }
    if (slide.title.length + slide.bullets.join('').length > 260) {
      issues.push({ severity: 'warning', slideIndex: index, message: '页面文本密度过高，真实预览中可能拥挤。' })
    }
    if (isContentSlide(slide.layout)) {
      const visibleTextLength = normalizeAuditText(getSlideVisibleText(slide)).length
      const pointCandidates = getSlidePointCandidates(slide)
      const meaningfulPointCount = pointCandidates.filter(isMeaningfulAuditPoint).length
      const shortLabelCount = pointCandidates.filter(isShortAuditLabel).length
      if (meaningfulPointCount < MIN_CONTENT_SLIDE_POINTS) {
        issues.push({ severity: 'error', slideIndex: index, message: '页面内容过薄，至少需要 3 条完整业务观点。' })
      }
      if (visibleTextLength < MIN_CONTENT_SLIDE_CHARS) {
        issues.push({ severity: 'error', slideIndex: index, message: '页面信息量不足，建议补充结论、依据和行动。' })
      }
      if (pointCandidates.length > 0 && shortLabelCount === pointCandidates.length) {
        issues.push({ severity: 'error', slideIndex: index, message: '页面要点只有短标签，请改成可汇报的完整观点句。' })
      }
    } else if (slide.layout === 'agenda') {
      const agendaItems = getSlidePointCandidates(slide)
      if (agendaItems.length < 4) {
        issues.push({ severity: 'warning', slideIndex: index, message: '目录页项目偏少，建议覆盖核心结论、诊断、策略和行动。' })
      }
    }

    const lastRun = layoutRuns[layoutRuns.length - 1]
    if (lastRun?.layout === slide.layout) {
      lastRun.count += 1
    } else {
      layoutRuns.push({ layout: slide.layout, count: 1, start: index })
    }

    if (slide.slideVariant) {
      const lastVariantRun = variantRuns[variantRuns.length - 1]
      if (lastVariantRun?.variant === slide.slideVariant) {
        lastVariantRun.count += 1
      } else {
        variantRuns.push({ variant: slide.slideVariant, count: 1, start: index })
      }
    }
  })

  for (const run of layoutRuns) {
    if (run.count >= 3) {
      issues.push({
        severity: 'warning',
        slideIndex: run.start,
        message: `连续 ${run.count} 页使用相同布局，建议变化版式。`,
      })
    }
  }

  for (const run of variantRuns) {
    if (run.count >= 3) {
      issues.push({
        severity: 'warning',
        slideIndex: run.start,
        message: `连续 ${run.count} 页使用相同视觉变体，建议调整构图节奏。`,
      })
    }
  }

  if (deck.slides[0]?.layout !== 'cover') {
    issues.push({ severity: 'warning', slideIndex: 0, message: '第一页建议使用封面布局。' })
  }

  return issues
}
