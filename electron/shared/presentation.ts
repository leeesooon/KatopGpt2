import { z } from 'zod'

export const PRESENTATION_THEME_IDS = [
  'executive-midnight',
  'warm-terra',
  'teal-trust',
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

export const PRESENTATION_CHART_TYPES = [
  'bar',
  'line',
  'pie',
] as const

export type PresentationThemeId = typeof PRESENTATION_THEME_IDS[number]
export type PresentationSlideLayout = typeof PRESENTATION_SLIDE_LAYOUTS[number]
export type PresentationVisualType = typeof PRESENTATION_VISUAL_TYPES[number]
export type PresentationChartType = typeof PRESENTATION_CHART_TYPES[number]

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

export interface PresentationSlideSpec {
  id: string
  layout: PresentationSlideLayout
  title: string
  subtitle?: string
  eyebrow?: string
  bullets: string[]
  speakerNotes?: string
  visual: PresentationVisualSpec
}

export interface PresentationDeckSpec {
  title: string
  subtitle?: string
  audience?: string
  goal?: string
  themeId: PresentationThemeId
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

export type PresentationQaSeverity = 'warning' | 'error'

export interface PresentationQaIssue {
  severity: PresentationQaSeverity
  slideIndex?: number
  message: string
}

const nonEmptyStringSchema = z.string().trim().min(1)

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

export const presentationSlideSpecSchema = z.object({
  id: nonEmptyStringSchema.max(64),
  layout: z.enum(PRESENTATION_SLIDE_LAYOUTS),
  title: nonEmptyStringSchema.max(52),
  subtitle: z.string().trim().max(90).optional(),
  eyebrow: z.string().trim().max(28).optional(),
  bullets: z.array(nonEmptyStringSchema.max(56)).max(6).default([]),
  speakerNotes: z.string().trim().max(600).optional(),
  visual: presentationVisualSpecSchema,
})

export const presentationDeckSpecSchema = z.object({
  title: nonEmptyStringSchema.max(72),
  subtitle: z.string().trim().max(120).optional(),
  audience: z.string().trim().max(80).optional(),
  goal: z.string().trim().max(120).optional(),
  themeId: z.enum(PRESENTATION_THEME_IDS),
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

export function auditPresentationDeckSpec(deck: PresentationDeckSpec): PresentationQaIssue[] {
  const issues: PresentationQaIssue[] = []
  const layoutRuns: Array<{ layout: PresentationSlideLayout; count: number; start: number }> = []

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
    if (!hasVisualPayload(slide.visual)) {
      issues.push({ severity: 'error', slideIndex: index, message: '页面缺少视觉元素。' })
    }

    const lastRun = layoutRuns[layoutRuns.length - 1]
    if (lastRun?.layout === slide.layout) {
      lastRun.count += 1
    } else {
      layoutRuns.push({ layout: slide.layout, count: 1, start: index })
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

  if (deck.slides[0]?.layout !== 'cover') {
    issues.push({ severity: 'warning', slideIndex: 0, message: '第一页建议使用封面布局。' })
  }

  return issues
}
