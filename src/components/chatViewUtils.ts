import { resolveApiConfig, supportsImageGeneration } from '../types'
import type { ApiConfig, AppSettings, FileAttachment, Message } from '../types'
import type { SpreadsheetExecutionPlan } from '../services/chatApi'

const MAX_CONTEXT_COUNTED_FILE_CHARS = 30000
const IMAGE_GENERATION_QUALITY_PROMPT = '自然真实的人体结构，正常五指，手部清晰自然，面部五官协调，肢体比例合理，避免多余手指、畸形手、扭曲肢体、崩坏面部、低质量细节。'

export interface ContextStats {
  messageCount: number
  messageChars: number
}

export function calculateContextStats(messages: Message[]): ContextStats {
  return messages.reduce(
    (stats, message) => {
      const imageChars = message.images?.length ? message.images.length * 120 : 0
      const fileChars = message.files?.reduce(
        (total, file) => total + Math.min((file.contextContent ?? file.content).length, MAX_CONTEXT_COUNTED_FILE_CHARS),
        0
      ) ?? 0
      return {
        messageCount: stats.messageCount + 1,
        messageChars: stats.messageChars + message.content.length + imageChars + fileChars,
      }
    },
    { messageCount: 0, messageChars: 0 }
  )
}

export function findLatestSpreadsheetAttachment(messages: Array<{ files?: FileAttachment[] }>, currentFiles: FileAttachment[]) {
  const currentMatch = currentFiles.find(
    (file) => (file.fileType === 'xlsx' || file.fileType === 'csv') && file.spreadsheetSessionId
  )
  if (currentMatch) return currentMatch

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const files = messages[index].files ?? []
    const matchedFile = files.find(
      (file) => (file.fileType === 'xlsx' || file.fileType === 'csv') && file.spreadsheetSessionId
    )
    if (matchedFile) {
      return matchedFile
    }
  }

  return null
}

export function shouldExecuteSpreadsheetInstruction(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return false

  return /(生成.*(?:sheet|工作表|图表|柱状图|折线图|饼图|条形图)|新\s*(?:sheet|工作表)|汇总|合计|求和|平均|均值|计数|条数|个数|数量|人数|多少人|有多少|分组|统计|分析|分布|占比|柱状图|折线图|饼图|条形图|图表)/i.test(trimmed)
    && /(excel|xlsx|csv|表格|工作表|sheet|按|列|字段|图表|画图|统计图|可视化|岗位|部门)/i.test(trimmed)
}

export function shouldExportSpreadsheetSession(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return false

  return /(导出|另存为|保存为|导出为)/i.test(trimmed)
    && /(excel|xlsx|表格|工作表|sheet|文件)/i.test(trimmed)
}

export function buildSpreadsheetRecentContext(messages: Array<{ role: string; content: string }>) {
  return messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content}`)
    .join('\n\n')
}

export function summarizeSpreadsheetPlan(plan: SpreadsheetExecutionPlan) {
  if (plan.explanation) return plan.explanation
  if (plan.intent === 'export') return '导出当前表格结果'
  if (plan.intent === 'chart') {
    return `基于${plan.useLastCreatedSheet ? '最近结果表' : '指定工作表'}生成${plan.chartType ?? 'bar'}图表`
  }
  if (plan.intent === 'filter_rows') {
    const filterText = plan.filters?.length
      ? plan.filters.map((filter) => `${filter.column}${filter.operator}${filter.value}`).join('，')
      : '无筛选条件'
    const selectText = plan.selectColumns?.length ? `，保留列 ${plan.selectColumns.join(' + ')}` : ''
    const sortText = plan.sortBy ? `，按 ${plan.sortBy} ${plan.sortDirection === 'asc' ? '升序' : '降序'}` : ''
    const topNText = plan.topN ? `，取前 ${plan.topN} 行` : ''
    return `筛选明细：${filterText}${selectText}${sortText}${topNText}`
  }
  if (plan.intent === 'script') {
    return plan.script?.summary ? `执行脚本计划：${plan.script.summary}` : '执行脚本计划'
  }

  const metricLabel = plan.intent === 'count'
    ? '计数'
    : plan.intent === 'sum'
      ? `汇总 ${plan.valueColumn ?? '数值列'}`
      : `统计 ${plan.valueColumn ?? '数值列'} 平均值`
  const groups = plan.groupByColumns?.join(' + ') || '未指定分组'
  const filterText = plan.filters?.length
    ? `，筛选 ${plan.filters.map((filter) => `${filter.column}${filter.operator}${filter.value}`).join('，')}`
    : ''
  const topNText = plan.topN ? `，取前 ${plan.topN} 项` : ''
  return `按 ${groups} ${metricLabel}${filterText}${topNText}`
}

export function resolveImageGenerationConfig(settings: AppSettings): ApiConfig | null {
  const imageSettings = settings.imageGeneration
  const explicitSelection = imageSettings.providerId && imageSettings.model
    ? { providerId: imageSettings.providerId, model: imageSettings.model }
    : null
  const explicitConfig = resolveApiConfig(settings.providers, explicitSelection)
  if (explicitConfig) return explicitConfig

  for (const provider of settings.providers) {
    const model = provider.models.find((item) => supportsImageGeneration(item))
    if (model) {
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: model.name,
        multimodal: model.multimodal,
      }
    }
  }

  return null
}

export function buildImageGenerationPrompt(userPrompt: string) {
  const trimmedPrompt = userPrompt.trim()
  if (!trimmedPrompt) return IMAGE_GENERATION_QUALITY_PROMPT
  return `${trimmedPrompt}\n\n质量要求：${IMAGE_GENERATION_QUALITY_PROMPT}`
}
