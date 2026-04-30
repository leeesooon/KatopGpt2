import type { ApiConfig, FileAttachment } from '../types'
import { completeChatText } from './chatApi'
import {
  auditPresentationDeckSpec,
  PRESENTATION_SLIDE_LAYOUTS,
  PRESENTATION_SLIDE_VARIANTS,
  PRESENTATION_SVG_VISUAL_TYPES,
  PRESENTATION_THEME_IDS,
  PRESENTATION_CHART_TYPES,
  PRESENTATION_VISUAL_TYPES,
  presentationDeckSpecSchema,
  type PresentationCodeArtifact,
  type PresentationCodeAsset,
  type PresentationCodeRequest,
  type PresentationDeckSpec,
  type PresentationDeckDensity,
  type PresentationPageStrategy,
  type PresentationChartData,
  type PresentationChartType,
  type PresentationQaIssue,
  type PresentationStat,
  type PresentationSlideLayout,
  type PresentationSlideSpec,
  type PresentationSlideVariant,
  type PresentationSvgVisualSpec,
  type PresentationSvgVisualType,
  type PresentationThemeId,
  type PresentationVisualSpec,
  type PresentationVisualType,
} from '../../electron/shared/presentation'

const MIN_SLIDE_COUNT = 3
const MAX_SLIDE_COUNT = 20
const MAX_REFERENCE_CHARS = 12000
const MIN_CONTENT_BULLETS = 3
const MAX_CONTENT_BULLETS = 5
const MIN_MEANINGFUL_POINT_CHARS = 12

const FULL_LAYOUT_SEQUENCE: PresentationSlideLayout[] = [
  'agenda',
  'data_highlight',
  'comparison',
  'cards',
  'timeline',
  'chart',
  'two_column',
  'section',
]

const COMPACT_LAYOUT_SEQUENCE: PresentationSlideLayout[] = [
  'data_highlight',
  'comparison',
  'timeline',
  'cards',
]

const DEFAULT_VARIANT_SEQUENCE: PresentationSlideVariant[] = [
  'cover_poster',
  'split_hero',
  'angled_panel',
  'card_grid',
  'process_ribbon',
  'comparison_matrix',
  'metric_wall',
  'architecture_map',
  'editorial_close',
]

const THEME_PALETTES: Record<PresentationThemeId, string[]> = {
  'executive-midnight': ['1E2761', 'CADCFC', 'FFFFFF', '12172F', 'F4F7FF'],
  'warm-terra': ['B85042', 'E7E8D1', 'A7BEAE', '3C241E', 'FFF7ED'],
  'teal-trust': ['028090', '00A896', '02C39A', '073B4C', 'E6FFFA'],
  'forest-moss': ['2C5F2D', '97BC62', 'F5F5F5', '172A19', 'F0F7E8'],
  'coral-energy': ['F96167', 'F9E795', '2F3C7E', '202A5A', 'FFF8D6'],
  'charcoal-minimal': ['36454F', 'F2F2F2', '212121', '111418', 'F7F7F4'],
  'berry-cream': ['6D2E46', 'A26769', 'ECE2D0', '2D1421', 'FDF4E3'],
}

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

export interface GeneratePresentationCodeDeckOptions {
  config: ApiConfig
  topic: string
  audience?: string
  goal?: string
  slideCount: number
  themeId: PresentationThemeId
  files: FileAttachment[]
  previousCode?: string
  failureMessage?: string
  stdout?: string
  stderr?: string
  signal?: AbortSignal
}

export interface GeneratePresentationCodeDeckResult {
  artifact: PresentationCodeArtifact
  input: PresentationCodeRequest
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

function buildCodeAssets(files: FileAttachment[]): PresentationCodeAsset[] {
  if (files.length === 0) return []

  const maxCharsPerFile = Math.floor(MAX_REFERENCE_CHARS / Math.max(files.length, 1))
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    fileType: file.fileType,
    content: truncateText(file.contextContent ?? file.content, maxCharsPerFile),
  }))
}

export function buildPresentationCodeInput(options: GeneratePresentationCodeDeckOptions): PresentationCodeRequest {
  return {
    topic: options.topic.trim(),
    audience: options.audience?.trim() || undefined,
    goal: options.goal?.trim() || undefined,
    slideCount: clampSlideCount(options.slideCount),
    themeId: options.themeId,
    files: buildCodeAssets(options.files),
  }
}

function buildCodePlannerSystemPrompt() {
  return [
    '你是一个 PPT Agent，需要直接编写可执行的 Node.js CommonJS 代码来生成 PPTX。',
    '你的唯一输出必须是完整 JavaScript 代码；不要输出 Markdown、解释、JSON、代码围栏或省略号。',
    '',
    '代码接口是固定的：',
    'module.exports.buildPresentation = async function buildPresentation({ pptxgen, input, assets, outputPath, workDir }) { ... }',
    '',
    '硬性运行规则：',
    '1. 代码必须创建 const pptx = new pptxgen()，设置 pptx.layout = "LAYOUT_WIDE"，并 await pptx.writeFile({ fileName: outputPath })。',
    '2. 必须生成正好 input.slideCount 页，第一页是封面，最后一页是行动建议或结尾页。',
    '3. 禁止依赖浏览器 DOM、window、document、canvas；可使用 Node 标准库，但不要联网、不要读写 outputPath/workDir 之外的路径。',
    '4. 使用 pptxgenjs 原生形状、文本、表格和手工绘制图表；不要插入远程图片。',
    '5. addShape 请直接使用字符串形状名，例如 "rect"、"roundRect"、"ellipse"、"line"，不要使用 pptx.ShapeType.rect。',
    '6. 使用 LAYOUT_WIDE 坐标体系：画布宽 13.333、高 7.5；安全内容区建议 x: 0.6~12.7、y: 0.45~7.05。',
    '7. 所有正文、图表、卡片、页码、图片和表格必须完全位于画布内；纯装饰背景圆形、色块、纹理允许明显出血和裁切，但不能承载正文信息。',
    '8. 中文字体优先使用 Microsoft YaHei；标题、正文、标签要分层，正文不要堆到页面边缘。',
    '9. JavaScript 必须是合法 CommonJS；禁止在函数调用中写裸命名参数，例如 fn(a, x: 1, y: 2) 是非法语法。',
    '10. 坐标只能用普通位置参数 fn(slide, text, x, y, w, h, opts)，或完整对象参数 fn(slide, text, { x, y, w, h }, opts)，不要混用。',
    '',
    '内容质量规则：',
    '1. 输出咨询汇报风：核心结论、经营诊断、增长策略、执行路径、行动建议要清晰。',
    '2. 非封面/结尾页必须有 3-5 条完整业务观点，每条包含“结论/问题 + 影响/动作”，禁止只写短词标签。',
    '3. 没有真实数据时，不要编造百分比、金额、同比等具体数字；可写“待补充数据/待确认口径”，或使用结构性数字如“三阶段、四类抓手”。',
    '4. 低页数规则：input.slideCount <= 5 时不要单独做目录页，优先安排封面、核心结论、问题诊断、增长策略、行动计划/结尾。',
    '5. 页面要有足够内容密度：使用卡片、矩阵、流程、对比表、行动表或手工条形图，不要只放大标题。',
    '6. 视觉风格要根据 input.themeId 调整配色和版式，不能所有主题都长一样。',
    '7. 正文卡片最多 2-3 行；长观点要拆短或降低字号，不要依赖 PowerPoint 自动撑高文本框。',
    '8. 底部 y > 6.9 的区域只允许页码、短标签或装饰，不允许放正文段落。',
    '',
    '返回值可以是 { title, slideCount }，但 PPTX 文件必须已经写入 outputPath。',
  ].join('\n')
}

function buildCodePlannerUserPrompt(options: GeneratePresentationCodeDeckOptions) {
  const input = buildPresentationCodeInput(options)
  const basePrompt = [
    '请为以下输入编写完整 JavaScript 代码：',
    JSON.stringify(input, null, 2),
    '',
    '请在代码中内置必要的布局函数，例如 addHeader、addCard、addWrappedText、drawProgressBars 或 drawActionTable。',
    '如果定义 addWrappedText/addCard 等 helper，请先固定函数签名，所有调用必须严格匹配该签名；不要写 x:、y:、w:、h: 这种裸参数。',
    '建议结构：封面、核心结论、现状诊断、增长策略、执行路径、关键风险/保障、行动计划、结尾；请按页数自动压缩或扩展。',
    '每页都必须通过真实 PPT 元素表达内容：至少包含标题、正文观点、结构化视觉或表格/图表。',
    '请在代码中定义常量 SLIDE_W = 13.333、SLIDE_H = 7.5，并用这些常量计算网格、卡片和页脚位置。',
  ]

  if (!options.previousCode && !options.failureMessage) {
    return basePrompt.join('\n')
  }

  return [
    ...basePrompt,
    '',
    '上一次代码运行失败，请基于错误修复，并输出修复后的完整代码，不要只给补丁。',
    '如果失败信息包含 SyntaxError 或源码片段，请优先修复对应行附近的 JavaScript 语法，并全文检查是否还有同类非法命名参数。',
    `失败信息：${options.failureMessage || '未提供'}`,
    options.stderr ? `stderr：\n${truncateText(options.stderr, 5000)}` : '',
    options.stdout ? `stdout：\n${truncateText(options.stdout, 3000)}` : '',
    options.previousCode ? `上一版代码：\n${truncateText(options.previousCode, 12000)}` : '',
  ].filter(Boolean).join('\n')
}

function buildPlannerSystemPrompt() {
  return [
    '你是专业中文 PPT 内容策划 + 视觉导演，负责把用户资料转成可导出的 PPT slide spec。',
    '你必须输出严格 JSON，不输出 Markdown、解释、代码围栏或注释。',
    '',
    '输出 JSON 结构：',
    '{"title":"PPT标题","subtitle":"副标题","audience":"受众","goal":"目标","themeId":"executive-midnight","deckStyle":{"tone":"视觉语气","density":"balanced","pageStrategy":"mixed","motif":"重复视觉母题"},"palette":["1E2761","CADCFC","FFFFFF"],"motif":"重复视觉母题","slides":[{"id":"slide-1","layout":"cover","slideVariant":"cover_poster","title":"页面标题","subtitle":"可选副标题","eyebrow":"可选眉题","bullets":["要点"],"speakerNotes":"演讲备注","visualFocus":"本页视觉焦点","svgVisual":{"kind":"orbital","label":"SVG视觉说明","emphasis":"hero","seed":12},"heroMetric":{"value":"3x","label":"核心指标"},"callouts":["标注"],"visual":{"type":"shape","label":"视觉说明","items":["视觉项"],"stats":[{"value":"60%","label":"指标"}],"chart":{"type":"bar","title":"图表标题","labels":["A","B"],"values":[40,60]}}}]}',
    '',
    '枚举字段只能填写单个字符串，禁止把 a|b|c 这种整串枚举写入字段值。',
    `themeId 可选值：${PRESENTATION_THEME_IDS.join(', ')}`,
    `layout 可选值：${PRESENTATION_SLIDE_LAYOUTS.join(', ')}`,
    `slideVariant 可选值：${PRESENTATION_SLIDE_VARIANTS.join(', ')}`,
    `svgVisual.kind 可选值：${PRESENTATION_SVG_VISUAL_TYPES.join(', ')}`,
    `visual.type 可选值：${PRESENTATION_VISUAL_TYPES.join(', ')}`,
    `visual.chart.type 可选值：${PRESENTATION_CHART_TYPES.join(', ')}`,
    '',
    '硬性规则，来自 PPTX skill 和当前 PPT 助手导出器：',
    '1. 每页必须有 visual，不能做纯文字页。',
    '2. 每页必须选择明确构图：封面海报、半屏视觉、斜切色块、数字巨幕、流程带、架构图、对比矩阵或结尾行动页。',
    '3. 避免普通标题 + 项目符号堆叠；每页要有 SVG 背景/插画、卡片、数字强调、图表、时间线或对比结构。',
    '4. 版式和 slideVariant 必须变化，不能连续 3 页使用同一 layout 或同一 slideVariant。',
    '5. 不默认蓝色；themeId、palette、motif 必须匹配用户选择和内容语境。',
    '6. 不要设计标题下划线式 accent line。',
    '7. 走咨询汇报风：高信息密度、清晰层级、矩阵/图表/卡片/行动表优先，避免海报式空泛表达。',
    '8. 非封面和结尾页必须有 3-5 条完整业务观点；每条要包含“结论/问题 + 影响/动作”，禁止只写“收入质量、获客效率、组织协同”这类短标签。',
    '9. 控制文字密度：标题不超过 26 个中文字；每条要点 18-40 个中文字，不要超过 56 个字。',
    '10. 数据强调页必须提供 heroMetric 或 visual.stats；图表页必须提供 chart.labels 与 chart.values，缺真实数据时图表标题必须标注“示意”或“待补充真实数据”。',
    '11. 输出中文内容，内部 id 使用英文短横线。',
    '12. 如果缺少数据，也要用合理的结构化占位表达，不要编造具体不可验证数字；可使用“3 个阶段”“4 项能力”这类结构性数字，或写“待补充数据/待确认口径”。',
  ].join('\n')
}

function buildPlannerUserPrompt(options: GeneratePresentationDeckOptions) {
  const slideCount = clampSlideCount(options.slideCount)
  const referenceContext = buildReferenceContext(options.files)

  const pageStrategy = slideCount <= 5
    ? '页数不超过 5 页时禁止使用 agenda/目录页；中间页必须依次覆盖：核心结论、问题诊断、增长策略或行动计划。'
    : '6 页及以上可以使用 agenda/目录页；中间页面应覆盖：核心结论、经营诊断、关键洞察、增长策略、执行路径、价值总结。'

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
    pageStrategy,
    '每个 bullets 项必须是可直接放到汇报页上的完整观点句，不能是短词标签；缺资料时使用“待补充数据/待确认口径”提示。',
    '每页都要输出 slideVariant、svgVisual、visualFocus；优先使用 orbital、mesh、process、network、architecture、radar、burst、texture 这些 SVG 类型。',
    '如果内容适合图表页，请使用 chart visual；否则使用 stat、cards、timeline、comparison 或 architecture。',
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

function stripJavaScriptCodeFence(value: string) {
  const trimmed = value.trim()
  const fencedCode = trimmed.match(/```(?:javascript|js|cjs)?\s*([\s\S]*?)```/i)
  if (fencedCode?.[1]) return fencedCode[1].trim()

  return trimmed
    .replace(/^```(?:javascript|js|cjs)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function normalizeGeneratedPresentationCode(rawCode: string) {
  let code = stripJavaScriptCodeFence(rawCode)

  code = code.replace(
    /export\s+async\s+function\s+buildPresentation\s*\(/,
    'async function buildPresentation('
  )
  code = code.replace(
    /export\s+function\s+buildPresentation\s*\(/,
    'function buildPresentation('
  )

  const exportsBuilder = /(module\.exports\s*=|module\.exports\.buildPresentation\s*=|exports\.buildPresentation\s*=)/.test(code)
  const declaresBuilder = /(async\s+function|function)\s+buildPresentation\s*\(/.test(code)
  if (!exportsBuilder && declaresBuilder) {
    code = `${code.trim()}\n\nmodule.exports.buildPresentation = buildPresentation\n`
  }

  return code.trim()
}

function extractCodeArtifact(rawText: string, options: GeneratePresentationCodeDeckOptions): PresentationCodeArtifact {
  const fallbackTitle = clipPlain(options.topic.trim() || 'KatopGPT PPT', 72)
  const stripped = rawText.trim()

  try {
    const parsed = JSON.parse(extractJsonObject(stripped))
    const record = asRecord(parsed)
    const rawCode = readString(record, 'code')
    if (rawCode) {
      const code = normalizeGeneratedPresentationCode(rawCode)
      if (!/buildPresentation/.test(code)) {
        throw new Error('生成代码没有包含 buildPresentation。')
      }
      return {
        title: readClippedString(record, 'title', 72, fallbackTitle),
        notes: readClippedString(record, 'notes', 1000) || undefined,
        code,
      }
    }
  } catch {
    // Fall back to treating the whole response as JavaScript code.
  }

  const code = normalizeGeneratedPresentationCode(stripped)
  if (!/buildPresentation/.test(code)) {
    throw new Error('PPT 代码生成失败：模型没有返回 buildPresentation 函数，请重试或换用更稳定的模型。')
  }

  return {
    title: fallbackTitle,
    notes: '模型返回了完整 PPT 生成代码。',
    code,
  }
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

function clipPlain(value: string, maxChars: number) {
  const normalized = value.trim()
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars).trimEnd()
}

function normalizePointText(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；：、])\s*/g, '$1')
    .trim()
}

function uniqueTextItems(items: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items.map(normalizePointText).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function isShortLabel(value: string) {
  const compact = normalizePointText(value).replace(/[，。；：、:：/／\-\s]/g, '')
  return compact.length > 0 && compact.length <= 8
}

function isMeaningfulPoint(value: string) {
  const text = normalizePointText(value)
  if (text.length < MIN_MEANINGFUL_POINT_CHARS) return false
  if (/[，。；：、:]/.test(text)) return true
  return /(需要|建议|通过|围绕|聚焦|明确|推动|提升|降低|建立|形成|拆解|复盘|落地|验证|优先|转化|沉淀)/.test(text)
}

function inferSlideRole(layout: PresentationSlideLayout, index: number, slideCount: number) {
  if (layout === 'data_highlight') return '核心结论'
  if (layout === 'comparison') return '问题诊断'
  if (layout === 'timeline') return '执行路径'
  if (layout === 'chart') return '指标复盘'
  if (layout === 'cards') return '增长抓手'
  if (layout === 'two_column') return '策略结构'
  if (layout === 'agenda') return '汇报主线'
  if (layout === 'closing' || index === slideCount - 1) return '行动建议'
  if (layout === 'section') return '阶段重点'
  return '关键观点'
}

function buildStructuredFallbackBullets(
  layout: PresentationSlideLayout,
  title: string,
  index: number,
  slideCount: number,
  options: GeneratePresentationDeckOptions
) {
  const topic = clipPlain(options.topic.trim() || '业务增长', 14)
  const titleFocus = clipPlain(title || topic, 14)
  const role = inferSlideRole(layout, index, slideCount)

  if (layout === 'agenda') {
    return [
      `核心结论：先统一${topic}复盘口径，避免只看结果不看质量`,
      '经营诊断：拆分收入、客户、产品和组织四类问题',
      '增长策略：把机会转成优先级、资源投入和验证路径',
      '行动计划：明确责任、节奏和复盘机制，推动闭环落地',
    ]
  }

  if (layout === 'data_highlight') {
    return [
      `${titleFocus}先看结构性变化，真实指标待补充统一口径`,
      '把规模、质量和效率分开判断，避免单一数字误导决策',
      '优先锁定影响增长的关键杠杆，再配置资源和验证节奏',
    ]
  }

  if (layout === 'comparison') {
    return [
      `${titleFocus}需要区分表层现象和根因，避免策略直接跳解法`,
      '问题侧先识别收入、客户和组织阻力，明确影响范围',
      '机会侧同步定义抓手、资源和验证方式，形成可执行方案',
      '优先级按影响、确定性和落地难度排序，减少分散投入',
    ]
  }

  if (layout === 'timeline' || layout === 'closing') {
    return [
      `${role}先拆成近期试点、中期扩展和长期固化三阶段`,
      '每个阶段绑定负责人、交付物和复盘节点，避免行动悬空',
      '用待确认指标追踪节奏和质量，持续修正增长动作',
    ]
  }

  if (layout === 'chart') {
    return [
      `${titleFocus}需要补齐真实数据口径，先用维度优先级示意`,
      '对比各维度的影响和可控性，识别最值得投入的方向',
      '图表结论要落到下一步验证动作，避免只展示数据本身',
    ]
  }

  if (layout === 'two_column') {
    return [
      `${titleFocus}应从目标、抓手和机制三层拆解，形成清晰结构`,
      '左侧呈现判断和依据，右侧映射策略模块和协同关系',
      '关键动作需要绑定资源、责任和验证方式，便于管理层决策',
    ]
  }

  return [
    `${titleFocus}要先明确业务判断，再拆成可落地的增长抓手`,
    '每个抓手说明影响对象、预期变化和待验证口径',
    '用阶段节奏和责任机制承接策略，确保从复盘走向行动',
  ]
}

function expandThinPoint(point: string, role: string) {
  const focus = clipPlain(normalizePointText(point) || role, 12)
  if (role === '问题诊断') {
    return `${focus}需要拆分为现象、根因和影响，避免只停留在标签描述`
  }
  if (role === '执行路径' || role === '行动建议') {
    return `${focus}要绑定责任人、交付物和复盘节奏，推动行动闭环`
  }
  if (role === '指标复盘' || role === '核心结论') {
    return `${focus}需要补齐真实数据口径，再判断质量、效率和趋势`
  }
  if (role === '汇报主线') {
    return `${focus}：明确本页结论、分析依据和后续动作`
  }
  return `${focus}要说明业务影响、优先级和下一步验证动作`
}

function ensureConsultingBullets(
  layout: PresentationSlideLayout,
  title: string,
  candidates: string[],
  index: number,
  slideCount: number,
  options: GeneratePresentationDeckOptions
) {
  const role = inferSlideRole(layout, index, slideCount)
  const minimum = layout === 'cover' ? 1 : layout === 'agenda' ? 4 : MIN_CONTENT_BULLETS
  const maximum = layout === 'agenda' ? 6 : MAX_CONTENT_BULLETS
  const expanded = uniqueTextItems(candidates)
    .map((item) => isMeaningfulPoint(item) ? item : expandThinPoint(item, role))
    .map((item) => clipPlain(item, 56))
    .filter(Boolean)
  const fallback = buildStructuredFallbackBullets(layout, title, index, slideCount, options)

  for (const item of fallback) {
    if (expanded.length >= minimum) break
    expanded.push(clipPlain(item, 56))
  }

  return uniqueTextItems(expanded).slice(0, maximum)
}

function toVisualItem(value: string) {
  const text = normalizePointText(value)
  const separatorIndex = text.search(/[，。；：、:]/)
  const item = separatorIndex > 0 ? text.slice(0, separatorIndex) : text
  return clipPlain(item || text, 42)
}

function buildVisualItems(layout: PresentationSlideLayout, visualItems: string[] | undefined, bullets: string[]) {
  const preferred = uniqueTextItems(visualItems ?? []).filter((item) => !isShortLabel(item) || item.length > 4)
  const source = preferred.length >= 3 ? preferred : bullets
  const maxItems = layout === 'timeline' || layout === 'agenda' ? 5 : 4
  return uniqueTextItems(source.map(toVisualItem)).slice(0, maxItems)
}

function buildCallouts(callouts: string[], bullets: string[]) {
  const preferred = uniqueTextItems(callouts).filter((item) => !isShortLabel(item))
  const source = preferred.length >= 2 ? preferred : bullets
  return uniqueTextItems(source.map(toVisualItem)).slice(0, 4)
}

function readClippedString(record: Record<string, unknown>, key: string, maxChars: number, fallback = '') {
  return clipPlain(readString(record, key, fallback), maxChars)
}

function readStringArray(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, maxItems)
    : []
}

function readClippedStringArray(value: unknown, maxItems: number, maxChars: number) {
  return readStringArray(value, maxItems).map((item) => clipPlain(item, maxChars)).filter(Boolean)
}

function readNumberArray(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value
        .map((item) => typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : Number.NaN)
        .filter(Number.isFinite)
        .slice(0, maxItems)
    : []
}

function resolveThemeId(value: unknown, fallback: PresentationThemeId): PresentationThemeId {
  return PRESENTATION_THEME_IDS.includes(value as PresentationThemeId)
    ? value as PresentationThemeId
    : fallback
}

function resolveLayout(value: unknown, index: number, slideCount: number): PresentationSlideLayout {
  if (index === 0) return 'cover'
  if (index === slideCount - 1) return 'closing'
  const requestedLayout = PRESENTATION_SLIDE_LAYOUTS.includes(value as PresentationSlideLayout)
    ? value as PresentationSlideLayout
    : undefined
  const compactFallback = COMPACT_LAYOUT_SEQUENCE[(index - 1) % COMPACT_LAYOUT_SEQUENCE.length]
  const fullFallback = FULL_LAYOUT_SEQUENCE[(index - 1) % FULL_LAYOUT_SEQUENCE.length]

  if (slideCount <= 5) {
    if (requestedLayout && !['cover', 'closing', 'agenda'].includes(requestedLayout)) {
      return requestedLayout
    }
    return compactFallback
  }

  if (requestedLayout && requestedLayout !== 'cover' && requestedLayout !== 'closing') {
    return requestedLayout
  }

  return fullFallback
}

function resolveSlideVariant(value: unknown, layout: PresentationSlideLayout, index: number): PresentationSlideVariant {
  if (PRESENTATION_SLIDE_VARIANTS.includes(value as PresentationSlideVariant)) {
    return value as PresentationSlideVariant
  }
  if (layout === 'cover') return 'cover_poster'
  if (layout === 'closing') return 'editorial_close'
  if (layout === 'timeline') return 'process_ribbon'
  if (layout === 'comparison') return 'comparison_matrix'
  if (layout === 'data_highlight') return 'metric_wall'
  if (layout === 'cards') return 'card_grid'
  if (layout === 'two_column') return index % 2 === 0 ? 'architecture_map' : 'split_hero'
  return DEFAULT_VARIANT_SEQUENCE[index % DEFAULT_VARIANT_SEQUENCE.length]
}

function resolveSvgKind(value: unknown, layout: PresentationSlideLayout, index: number): PresentationSvgVisualType {
  if (PRESENTATION_SVG_VISUAL_TYPES.includes(value as PresentationSvgVisualType)) {
    return value as PresentationSvgVisualType
  }
  if (layout === 'cover') return 'orbital'
  if (layout === 'section') return 'burst'
  if (layout === 'timeline') return 'process'
  if (layout === 'comparison') return 'texture'
  if (layout === 'data_highlight') return 'burst'
  if (layout === 'chart') return 'mesh'
  if (layout === 'two_column') return index % 2 === 0 ? 'architecture' : 'network'
  if (layout === 'closing') return 'orbital'
  return 'mesh'
}

function resolveVisualType(
  value: unknown,
  layout: PresentationSlideLayout,
  fallback: PresentationVisualType,
  visualRecord: Record<string, unknown>
): PresentationVisualType {
  if (PRESENTATION_VISUAL_TYPES.includes(value as PresentationVisualType)) {
    return value as PresentationVisualType
  }

  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw.includes('|')) return fallback
  if (raw.includes('chart') || raw.includes('graph')) return 'chart'
  if (raw.includes('stat') || raw.includes('metric') || raw.includes('kpi') || raw.includes('number')) return 'stat'
  if (raw.includes('timeline') || raw.includes('roadmap') || raw.includes('process')) return 'timeline'
  if (raw.includes('comparison') || raw.includes('compare') || raw.includes('matrix')) return 'comparison'
  if (raw.includes('card') || raw.includes('icon')) return 'icon_grid'
  if (raw.includes('shape') || raw.includes('diagram') || raw.includes('architecture') || raw.includes('network')) return 'shape'
  if (layout === 'chart' || Object.keys(asRecord(visualRecord.chart)).length > 0) return 'chart'
  if (layout === 'data_highlight') return 'stat'
  if (layout === 'timeline') return 'timeline'
  if (layout === 'comparison') return 'comparison'
  if (layout === 'cards') return 'icon_grid'
  return fallback
}

function resolveChartType(value: unknown, fallback: PresentationChartType): PresentationChartType {
  if (PRESENTATION_CHART_TYPES.includes(value as PresentationChartType)) {
    return value as PresentationChartType
  }
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw.includes('line')) return 'line'
  if (raw.includes('pie') || raw.includes('donut')) return 'pie'
  return fallback
}

function resolveDeckDensity(value: unknown): PresentationDeckDensity {
  return value === 'calm' || value === 'dense' || value === 'balanced' ? value : 'balanced'
}

function resolvePageStrategy(value: unknown): PresentationPageStrategy {
  return value === 'mostly-light' || value === 'dark-led' || value === 'mixed' ? value : 'mixed'
}

function buildDefaultSvgVisual(layout: PresentationSlideLayout, visual: PresentationVisualSpec, index: number): PresentationSvgVisualSpec {
  return {
    kind: resolveSvgKind(undefined, layout, index),
    label: visual.label || '结构化视觉',
    emphasis: layout === 'cover' || layout === 'section' || layout === 'closing' ? 'hero' : 'background',
    seed: index + 21,
  }
}

function normalizeStats(value: unknown, fallback: PresentationStat[] | undefined) {
  const rawStats = Array.isArray(value) ? value : []
  const stats = rawStats.map((item) => {
    const record = asRecord(item)
    const valueText = readClippedString(record, 'value', 18)
    const label = readClippedString(record, 'label', 40)
    return valueText && label ? { value: valueText, label } : null
  }).filter((item): item is PresentationStat => Boolean(item)).slice(0, 4)

  return stats.length > 0 ? stats : fallback
}

function normalizeChart(value: unknown, fallback: PresentationChartData | undefined) {
  const chart = asRecord(value)
  const fallbackLabels = fallback?.labels ?? ['影响程度', '可控性', '落地难度']
  const fallbackValues = fallback?.values ?? fallbackLabels.map((_, index) => Math.max(2, 4 - index))
  const labels = readClippedStringArray(chart.labels, 8, 24)
  const values = readNumberArray(chart.values, 8)
  const safeLabels = labels.length >= 2 ? labels : fallbackLabels
  const fallbackSeries = safeLabels.map((_, index) => fallbackValues[index] ?? Math.max(1, safeLabels.length - index))
  const safeValues = values.length === safeLabels.length ? values : fallbackSeries

  return {
    type: resolveChartType(chart.type, fallback?.type ?? 'bar'),
    title: readClippedString(chart, 'title', 48, fallback?.title ?? '优先级示意，待补充真实数据') || undefined,
    labels: safeLabels.slice(0, 8),
    values: safeValues.length >= 2 ? safeValues : safeLabels.map((_, index) => Math.max(1, safeLabels.length - index)),
  }
}

function normalizeVisual(
  visualRecord: Record<string, unknown>,
  defaultVisual: PresentationVisualSpec,
  layout: PresentationSlideLayout
): PresentationVisualSpec {
  const type = resolveVisualType(visualRecord.type, layout, defaultVisual.type, visualRecord)
  const items = readClippedStringArray(visualRecord.items, 6, 42)
  const normalizedStats = normalizeStats(visualRecord.stats, defaultVisual.stats)
  const normalizedChart = normalizeChart(visualRecord.chart, defaultVisual.chart)

  return {
    type,
    label: readClippedString(visualRecord, 'label', 60, defaultVisual.label ?? '结构化视觉') || undefined,
    items: items.length > 0 ? items : defaultVisual.items,
    stats: normalizedStats,
    chart: type === 'chart' || layout === 'chart' || visualRecord.chart ? normalizedChart : defaultVisual.chart,
  }
}

function normalizePalette(value: unknown, fallback: string[]) {
  const colors = readStringArray(value, 8)
    .map((item) => item.replace(/^#/, '').trim())
    .filter((item) => /^[0-9a-f]{6}$/i.test(item))
  return colors.length >= 3 ? colors : fallback
}

function formatDeckValidationIssue(issue: { path: PropertyKey[]; message: string }) {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'PPT 结构'
  if (/invalid option|expected one of/i.test(issue.message)) {
    return `${path} 返回了不支持的选项，已自动修复失败，请重新生成。`
  }
  if (/too_big|max/i.test(issue.message)) {
    return `${path} 文本过长，请缩短后重试。`
  }
  if (/too_small|min/i.test(issue.message)) {
    return `${path} 内容不足，请补充后重试。`
  }
  return `${path}：${issue.message}`
}

function buildDefaultVisual(layout: PresentationSlideLayout, bullets: string[], index: number): PresentationVisualSpec {
  if (layout === 'chart') {
    const chartLabels = bullets.slice(0, 4).map((item) => item.slice(0, 8)).filter(Boolean)
    const safeLabels = chartLabels.length >= 2 ? chartLabels : ['影响程度', '可控性', '落地难度']
    return {
      type: 'chart',
      label: '关键维度优先级',
      chart: {
        type: 'bar',
        title: '优先级示意，待补充真实数据',
        labels: safeLabels,
        values: safeLabels.map((_, itemIndex) => Math.max(2, 4 - itemIndex)),
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
  const deckStyleRecord = asRecord(raw.deckStyle)
  const resolvedThemeId = resolveThemeId(raw.themeId, options.themeId)
  const rawSlides = Array.isArray(raw.slides) ? raw.slides.slice(0, slideCount) : []
  const slides: PresentationSlideSpec[] = rawSlides.map((rawSlide, index) => {
    const slide = asRecord(rawSlide)
    const layout = resolveLayout(slide.layout, index, slideCount)
    const title = readClippedString(slide, 'title', 52, index === 0 ? options.topic.trim() : `第 ${index + 1} 页`)
    const subtitle = readClippedString(slide, 'subtitle', 90) || undefined
    const visualRecord = asRecord(slide.visual)
    const rawBullets = readClippedStringArray(slide.bullets ?? slide.points, 6, 56)
    const rawVisualItems = readClippedStringArray(visualRecord.items, 6, 56)
    const rawCallouts = readClippedStringArray(slide.callouts, 4, 56)
    const bullets = ensureConsultingBullets(
      layout,
      title,
      [
        ...rawBullets,
        ...(subtitle ? [subtitle] : []),
        ...rawVisualItems,
        ...rawCallouts,
        readString(visualRecord, 'label'),
      ],
      index,
      slideCount,
      options
    )
    const defaultVisual = buildDefaultVisual(layout, bullets, index)
    const normalizedVisual = normalizeVisual(visualRecord, defaultVisual, layout)
    const visual = {
      ...normalizedVisual,
      items: buildVisualItems(layout, normalizedVisual.items, bullets),
    }
    const svgVisualRecord = asRecord(slide.svgVisual)
    const defaultSvgVisual = buildDefaultSvgVisual(layout, visual, index)
    const heroMetricRecord = asRecord(slide.heroMetric)
    const explicitHeroMetric = readString(heroMetricRecord, 'value') && readString(heroMetricRecord, 'label')
      ? {
          value: readClippedString(heroMetricRecord, 'value', 18),
          label: readClippedString(heroMetricRecord, 'label', 40),
        }
      : undefined
    const defaultHeroMetric = visual.stats?.[0]
      ?? explicitHeroMetric
      ?? (layout === 'data_highlight' ? { value: `${Math.min(9, index + 2)}x`, label: '核心放大点' } : undefined)

    return {
      id: readString(slide, 'id', `slide-${index + 1}`),
      layout,
      slideVariant: resolveSlideVariant(slide.slideVariant, layout, index),
      title,
      subtitle,
      eyebrow: readClippedString(slide, 'eyebrow', 28) || undefined,
      bullets,
      speakerNotes: readClippedString(slide, 'speakerNotes', 600) || undefined,
      visual,
      svgVisual: {
        ...defaultSvgVisual,
        label: readClippedString(svgVisualRecord, 'label', 60, defaultSvgVisual.label ?? '结构化视觉') || undefined,
        emphasis: ['background', 'hero', 'diagram', 'texture'].includes(readString(svgVisualRecord, 'emphasis'))
          ? readString(svgVisualRecord, 'emphasis') as PresentationSvgVisualSpec['emphasis']
          : defaultSvgVisual.emphasis,
        seed: typeof svgVisualRecord.seed === 'number' && Number.isInteger(svgVisualRecord.seed)
          ? Math.max(0, Math.min(9999, svgVisualRecord.seed))
          : defaultSvgVisual.seed,
        kind: resolveSvgKind(svgVisualRecord.kind, layout, index),
      },
      heroMetric: defaultHeroMetric
        ? {
            value: readClippedString(heroMetricRecord, 'value', 18, defaultHeroMetric.value),
            label: readClippedString(heroMetricRecord, 'label', 40, defaultHeroMetric.label),
          }
        : undefined,
      callouts: buildCallouts(readClippedStringArray(slide.callouts, 4, 42), bullets),
      visualFocus: readClippedString(slide, 'visualFocus', 72, visual.label || defaultSvgVisual.label) || undefined,
    }
  })

  while (slides.length < slideCount) {
    const index = slides.length
    const layout = resolveLayout(undefined, index, slideCount)
    const title = index === 0 ? clipPlain(options.topic.trim(), 52) : `第 ${index + 1} 页`
    const bullets = ensureConsultingBullets(layout, title, [], index, slideCount, options)
    const visual = buildDefaultVisual(layout, bullets, index)
    slides.push({
      id: `slide-${index + 1}`,
      layout,
      slideVariant: resolveSlideVariant(undefined, layout, index),
      title,
      subtitle: undefined,
      eyebrow: undefined,
      bullets,
      speakerNotes: undefined,
      visual: {
        ...visual,
        items: buildVisualItems(layout, visual.items, bullets),
      },
      svgVisual: buildDefaultSvgVisual(layout, visual, index),
      heroMetric: layout === 'data_highlight' ? { value: `${Math.min(9, index + 2)}x`, label: '核心放大点' } : undefined,
      callouts: buildCallouts([], bullets),
      visualFocus: '结构化视觉',
    })
  }

  if (slides.length > 0) {
    slides[0] = {
      ...slides[0],
      layout: 'cover',
      slideVariant: 'cover_poster',
      svgVisual: { ...(slides[0].svgVisual ?? buildDefaultSvgVisual('cover', slides[0].visual, 0)), kind: 'orbital' },
    }
  }
  if (slides.length > 1) {
    const lastIndex = slides.length - 1
    const closingBullets = ensureConsultingBullets('closing', slides[lastIndex].title, slides[lastIndex].bullets, lastIndex, slides.length, options)
    slides[lastIndex] = {
      ...slides[lastIndex],
      layout: 'closing',
      slideVariant: 'editorial_close',
      svgVisual: { ...(slides[lastIndex].svgVisual ?? buildDefaultSvgVisual('closing', slides[lastIndex].visual, lastIndex)), kind: 'orbital' },
      bullets: closingBullets,
      visual: {
        ...slides[lastIndex].visual,
        items: buildVisualItems('closing', slides[lastIndex].visual.items, closingBullets),
      },
      callouts: buildCallouts(slides[lastIndex].callouts ?? [], closingBullets),
    }
  }

  return {
    title: readClippedString(raw, 'title', 72, options.topic.trim()),
    subtitle: readClippedString(raw, 'subtitle', 120) || undefined,
    audience: readClippedString(raw, 'audience', 80, options.audience?.trim()) || undefined,
    goal: readClippedString(raw, 'goal', 120, options.goal?.trim()) || undefined,
    themeId: resolvedThemeId,
    deckStyle: {
      tone: readClippedString(deckStyleRecord, 'tone', 44, '专业、克制、有视觉记忆点') || undefined,
      density: resolveDeckDensity(deckStyleRecord.density),
      pageStrategy: resolvePageStrategy(deckStyleRecord.pageStrategy),
      motif: readClippedString(deckStyleRecord, 'motif', 48, readString(raw, 'motif', '重复图形母题')) || undefined,
    },
    palette: normalizePalette(raw.palette, THEME_PALETTES[resolvedThemeId]),
    motif: readClippedString(raw, 'motif', 48, readString(deckStyleRecord, 'motif', '重复图形母题')) || undefined,
    slides,
  }
}

export async function generatePresentationCodeDeck(
  options: GeneratePresentationCodeDeckOptions
): Promise<GeneratePresentationCodeDeckResult> {
  const topic = options.topic.trim()
  if (!topic) {
    throw new Error('请先输入 PPT 主题。')
  }

  const input = buildPresentationCodeInput(options)
  const rawText = await completeChatText(
    options.config,
    [
      { role: 'system', content: buildCodePlannerSystemPrompt() },
      { role: 'user', content: buildCodePlannerUserPrompt(options) },
    ],
    options.previousCode || options.failureMessage ? 0.35 : 0.5,
    14000,
    options.signal
  )

  return {
    artifact: extractCodeArtifact(rawText, options),
    input,
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
    0.55,
    6800,
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
    throw new Error(`PPT 大纲结构校验失败：${firstIssue ? formatDeckValidationIssue(firstIssue) : '未知字段错误'}`)
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
