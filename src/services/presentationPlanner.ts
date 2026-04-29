import type { ApiConfig, FileAttachment } from '../types'
import { completeChatText } from './chatApi'
import {
  auditPresentationDeckSpec,
  PRESENTATION_SLIDE_LAYOUTS,
  PRESENTATION_THEME_IDS,
  presentationDeckSpecSchema,
  type PresentationDeckSpec,
  type PresentationQaIssue,
  type PresentationSlideLayout,
  type PresentationThemeId,
  type PresentationVisualSpec,
} from '../../electron/shared/presentation'

const MIN_SLIDE_COUNT = 3
const MAX_SLIDE_COUNT = 20
const MAX_REFERENCE_CHARS = 12000

const DEFAULT_LAYOUT_SEQUENCE: PresentationSlideLayout[] = [
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
]

export interface GeneratePresentationDeckOptions {
  config: ApiConfig
  topic: string
  audience?: string
  goal?: string
  slideCount: number
  themeId: PresentationThemeId
  files: FileAttachment[]
  signal?: AbortSignal
}

export interface GeneratePresentationDeckResult {
  deck: PresentationDeckSpec
  issues: PresentationQaIssue[]
}

function clampSlideCount(value: number) {
  if (!Number.isFinite(value)) return 8
  return Math.min(MAX_SLIDE_COUNT, Math.max(MIN_SLIDE_COUNT, Math.round(value)))
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[已截断]`
}

function buildReferenceContext(files: FileAttachment[]) {
  if (files.length === 0) return ''

  const parts = files.map((file, index) => [
    `资料 ${index + 1}：${file.name}（${file.fileType ?? 'file'}）`,
    '```',
    truncateText(file.contextContent ?? file.content, Math.floor(MAX_REFERENCE_CHARS / Math.max(files.length, 1))),
    '```',
  ].join('\n'))

  return truncateText(parts.join('\n\n'), MAX_REFERENCE_CHARS)
}

function buildPlannerSystemPrompt() {
  return [
    '你是专业中文 PPT 策划与版式导演，负责把用户资料转成可导出的 PPT slide spec。',
    '你必须输出严格 JSON，不输出 Markdown、解释、代码围栏或注释。',
    '',
    '输出 JSON 结构：',
    '{"title":"PPT标题","subtitle":"副标题","audience":"受众","goal":"目标","themeId":"executive-midnight|warm-terra|teal-trust","slides":[{"id":"slide-1","layout":"cover|agenda|section|cards|two_column|timeline|comparison|data_highlight|chart|closing","title":"页面标题","subtitle":"可选副标题","eyebrow":"可选眉题","bullets":["要点"],"speakerNotes":"演讲备注","visual":{"type":"shape|icon_grid|stat|chart|timeline|comparison","label":"视觉说明","items":["视觉项"],"stats":[{"value":"60%","label":"指标"}],"chart":{"type":"bar|line|pie","title":"图表标题","labels":["A","B"],"values":[40,60]}}}]}',
    '',
    '硬性规则，来自 PPTX skill：',
    '1. 每页必须有 visual，不能做纯文字页。',
    '2. 避免普通标题 + 项目符号堆叠；每页要有形状、卡片、数字强调、图表、时间线或对比结构。',
    '3. 版式必须变化，不能连续 3 页使用同一 layout。',
    '4. 不默认蓝色；主题色必须匹配用户选择的 themeId。',
    '5. 不要设计标题下划线式 accent line。',
    '6. 控制文字密度：标题不超过 26 个中文字；每页 3-5 条要点；每条要点不超过 28 个中文字。',
    '7. 输出中文内容，内部 id 使用英文短横线。',
    '8. 如果缺少数据，也要用合理的结构化占位表达，不要编造具体不可验证数字；可使用“3 个阶段”“4 项能力”这类结构性数字。',
  ].join('\n')
}

function buildPlannerUserPrompt(options: GeneratePresentationDeckOptions) {
  const slideCount = clampSlideCount(options.slideCount)
  const referenceContext = buildReferenceContext(options.files)

  return [
    `主题：${options.topic.trim()}`,
    `目标受众：${options.audience?.trim() || '未指定，请按通用商务受众处理'}`,
    `沟通目标：${options.goal?.trim() || '未指定，请帮助用户清晰表达核心观点'}`,
    `页数：${slideCount}`,
    `主题风格：${options.themeId}`,
    '',
    referenceContext ? `参考资料：\n${referenceContext}` : '参考资料：无',
    '',
    `请生成正好 ${slideCount} 页。第一页 layout 必须是 cover；最后一页 layout 必须是 closing。`,
    '中间页面应覆盖：议程/背景、关键洞察、方案结构、执行路径、价值或总结。',
    '如果内容适合图表页，请使用 chart visual；否则使用 stat、cards、timeline 或 comparison。',
  ].join('\n')
}

function stripJsonCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractBalancedJsonObject(value: string, startIndex: number) {
  const expectedClosers: string[] = []
  let isInString = false
  let isEscaped = false

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]

    if (isInString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        isInString = false
      }
      continue
    }

    if (char === '"') {
      isInString = true
      continue
    }

    if (char === '{') {
      expectedClosers.push('}')
      continue
    }

    if (char === '[') {
      expectedClosers.push(']')
      continue
    }

    if (char === '}' || char === ']') {
      const expectedCloser = expectedClosers.pop()
      if (expectedCloser !== char) return null
      if (expectedClosers.length === 0) return value.slice(startIndex, index + 1)
    }
  }

  return null
}

function extractJsonObject(rawText: string) {
  const text = stripJsonCodeFence(rawText)
  if (text.startsWith('{')) return text
  const jsonStart = text.indexOf('{')
  return jsonStart >= 0 ? extractBalancedJsonObject(text, jsonStart) ?? text : text
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(record: Record<string, unknown>, key: string, fallback = '') {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function readStringArray(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, maxItems)
    : []
}

function resolveThemeId(value: unknown, fallback: PresentationThemeId): PresentationThemeId {
  return PRESENTATION_THEME_IDS.includes(value as PresentationThemeId)
    ? value as PresentationThemeId
    : fallback
}

function resolveLayout(value: unknown, index: number, slideCount: number): PresentationSlideLayout {
  if (PRESENTATION_SLIDE_LAYOUTS.includes(value as PresentationSlideLayout)) {
    return value as PresentationSlideLayout
  }
  if (index === 0) return 'cover'
  if (index === slideCount - 1) return 'closing'
  return DEFAULT_LAYOUT_SEQUENCE[index % DEFAULT_LAYOUT_SEQUENCE.length]
}

function buildDefaultVisual(layout: PresentationSlideLayout, bullets: string[], index: number): PresentationVisualSpec {
  if (layout === 'chart') {
    const chartLabels = bullets.slice(0, 4).map((item) => item.slice(0, 8)).filter(Boolean)
    const safeLabels = chartLabels.length >= 2 ? chartLabels : ['维度 A', '维度 B', '维度 C']
    return {
      type: 'chart',
      label: '关键指标对比',
      chart: {
        type: 'bar',
        title: '关键维度对比',
        labels: safeLabels,
        values: safeLabels.map((_, itemIndex) => Math.max(20, 80 - itemIndex * 12)),
      },
    }
  }

  if (layout === 'timeline') {
    return { type: 'timeline', label: '推进路径', items: bullets.slice(0, 5) }
  }

  if (layout === 'comparison') {
    return { type: 'comparison', label: '对比框架', items: bullets.slice(0, 4) }
  }

  if (layout === 'data_highlight') {
    return {
      type: 'stat',
      label: '重点指标',
      stats: [
        { value: `${Math.min(9, index + 2)}x`, label: '核心放大点' },
        { value: `${Math.min(6, bullets.length || 3)}`, label: '关键抓手' },
      ],
    }
  }

  return {
    type: layout === 'cards' ? 'icon_grid' : 'shape',
    label: '结构化视觉',
    items: bullets.slice(0, 4),
  }
}

function normalizeDeck(rawValue: unknown, options: GeneratePresentationDeckOptions) {
  const raw = asRecord(rawValue)
  const slideCount = clampSlideCount(options.slideCount)
  const rawSlides = Array.isArray(raw.slides) ? raw.slides.slice(0, slideCount) : []
  const slides = rawSlides.map((rawSlide, index) => {
    const slide = asRecord(rawSlide)
    const layout = resolveLayout(slide.layout, index, slideCount)
    const bullets = readStringArray(slide.bullets ?? slide.points, 6)
    const visualRecord = asRecord(slide.visual)
    const defaultVisual = buildDefaultVisual(layout, bullets, index)
    const visual = {
      ...defaultVisual,
      ...visualRecord,
    }

    return {
      id: readString(slide, 'id', `slide-${index + 1}`),
      layout,
      title: readString(slide, 'title', index === 0 ? options.topic.trim() : `第 ${index + 1} 页`),
      subtitle: readString(slide, 'subtitle') || undefined,
      eyebrow: readString(slide, 'eyebrow') || undefined,
      bullets,
      speakerNotes: readString(slide, 'speakerNotes') || undefined,
      visual,
    }
  })

  while (slides.length < slideCount) {
    const index = slides.length
    const layout = resolveLayout(undefined, index, slideCount)
    const bullets = ['提炼核心信息', '压缩页面表达', '保留视觉结构']
    slides.push({
      id: `slide-${index + 1}`,
      layout,
      title: index === 0 ? options.topic.trim() : `第 ${index + 1} 页`,
      subtitle: undefined,
      eyebrow: undefined,
      bullets,
      speakerNotes: undefined,
      visual: buildDefaultVisual(layout, bullets, index),
    })
  }

  if (slides.length > 0) slides[0] = { ...slides[0], layout: 'cover' }
  if (slides.length > 1) slides[slides.length - 1] = { ...slides[slides.length - 1], layout: 'closing' }

  return {
    title: readString(raw, 'title', options.topic.trim()),
    subtitle: readString(raw, 'subtitle') || undefined,
    audience: readString(raw, 'audience', options.audience?.trim()) || undefined,
    goal: readString(raw, 'goal', options.goal?.trim()) || undefined,
    themeId: resolveThemeId(raw.themeId, options.themeId),
    slides,
  }
}

export async function generatePresentationDeck(options: GeneratePresentationDeckOptions): Promise<GeneratePresentationDeckResult> {
  const topic = options.topic.trim()
  if (!topic) {
    throw new Error('请先输入 PPT 主题。')
  }

  const rawText = await completeChatText(
    options.config,
    [
      { role: 'system', content: buildPlannerSystemPrompt() },
      { role: 'user', content: buildPlannerUserPrompt(options) },
    ],
    0.45,
    4200,
    options.signal
  )

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonObject(rawText))
  } catch {
    throw new Error('PPT 大纲生成失败：模型没有返回有效 JSON，请重试或换用更稳定的模型。')
  }

  const normalized = normalizeDeck(parsedJson, options)
  const parsedDeck = presentationDeckSpecSchema.safeParse(normalized)
  if (!parsedDeck.success) {
    const firstIssue = parsedDeck.error.issues[0]
    throw new Error(`PPT 大纲结构校验失败：${firstIssue?.message ?? '未知字段错误'}`)
  }

  return {
    deck: parsedDeck.data,
    issues: auditPresentationDeckSpec(parsedDeck.data),
  }
}

export function auditPresentationDeck(deck: PresentationDeckSpec) {
  return auditPresentationDeckSpec(deck)
}

export { clampSlideCount }
