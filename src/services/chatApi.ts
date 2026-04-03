import type { ApiConfig, Message, ImageAttachment, FileAttachment } from '../types'

export class ChatApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'ChatApiError'
  }
}

interface ChatCompletionChunk {
  choices: Array<{
    delta: { content?: string; role?: string }
    finish_reason: string | null
  }>
}

interface ParsedStreamLine {
  chunk?: ChatCompletionChunk
  content?: string
  isDone: boolean
}

interface ApiConnectionTestResult {
  ok: boolean
  status?: number
  error?: string
}

export interface SpreadsheetColumnSchema {
  name: string
  inferredType: 'string' | 'number' | 'boolean' | 'date' | 'mixed' | 'empty'
}

export interface SpreadsheetSheetSchema {
  name: string
  rowCount: number
  columnCount: number
  columns: SpreadsheetColumnSchema[]
}

export interface SpreadsheetWorkbookSchema {
  sheets: SpreadsheetSheetSchema[]
}

export interface SpreadsheetPlannerFilter {
  column: string
  operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}

export interface SpreadsheetExecutionPlan {
  intent: 'count' | 'sum' | 'avg' | 'chart' | 'export' | 'script' | 'filter_rows'
  sourceSheetName?: string
  groupByColumns?: string[]
  valueColumn?: string
  filters?: SpreadsheetPlannerFilter[]
  selectColumns?: string[]
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  chartType?: 'bar' | 'line' | 'pie' | 'horizontalBar'
  targetSheetName?: string
  useLastCreatedSheet?: boolean
  topN?: number
  script?: {
    language: 'javascript'
    code: string
    summary?: string
  }
}

interface SpreadsheetIntentParseResult {
  shouldExecute: boolean
  normalizedInstruction?: string
  plan?: SpreadsheetExecutionPlan
}

interface ElectronChatStreamRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<{ role: string; content: string | ContentPart[] }>
  temperature: number
  maxTokens: number
}

type ElectronChatStreamEvent =
  | { streamId: string; type: 'chunk'; chunk: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string; status?: number }
  | { streamId: string; type: 'aborted' }

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

const MAX_FILE_CONTEXT_CHARS = 12000

function clipFileContext(content: string) {
  if (content.length <= MAX_FILE_CONTEXT_CHARS) {
    return content
  }

  return `${content.slice(0, MAX_FILE_CONTEXT_CHARS).trimEnd()}\n\n[已截断，原始内容过长]`
}

/**
 * Build the messages array for the API call.
 * For multimodal models, images are embedded as image_url content parts.
 * For non-multimodal models, images should have been OCR'd already —
 * this function ignores them.
 */
function buildApiMessages(
  messages: Message[],
  systemPrompt: string,
  multimodal: boolean,
  referenceContext?: string
): Array<{ role: string; content: string | ContentPart[] }> {
  // Inject reference context into system prompt if provided
  const enhancedSystemPrompt = referenceContext 
    ? `${systemPrompt}\n\n以下是补充参考资料（可能包含用户提供的网页内容和网络搜索结果）。请基于这些资料回答，并在引用时使用 [1], [2] 等标记：\n\n${referenceContext}`
    : systemPrompt
  
  const result: Array<{ role: string; content: string | ContentPart[] }> = [
    { role: 'system', content: enhancedSystemPrompt },
  ]

  for (const m of messages) {
    // Build text content — inject file contents before user text
    let textContent = m.content
    if (m.files && m.files.length > 0) {
      const fileParts = m.files.map((f) => {
        const label = `[文件: ${f.name}]`
        return `${label}\n\`\`\`\n${clipFileContext(f.content)}\n\`\`\``
      })
      textContent = fileParts.join('\n\n') + (textContent ? '\n\n' + textContent : '')
    }

    if (multimodal && m.images && m.images.length > 0) {
      const parts: ContentPart[] = []
      if (textContent) {
        parts.push({ type: 'text', text: textContent })
      }
      for (const img of m.images) {
        parts.push({ type: 'image_url', image_url: { url: img.base64 } })
      }
      result.push({ role: m.role, content: parts })
    } else {
      result.push({ role: m.role, content: textContent })
    }
  }

  return result
}

async function parseApiErrorResponse(response: Response) {
  let message = `API 请求失败 (${response.status})`
  let errorBody: unknown = null

  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      errorBody = await response.json()
      message = (errorBody as Record<string, Record<string, string>>)?.error?.message ?? message
    } else {
      const text = (await response.text()).trim()
      if (text) {
        message = text.length > 300 ? `${text.slice(0, 300).trimEnd()}...` : text
      }
    }
  } catch {
    // ignore parse error
  }

  return { message, errorBody }
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
    return null
  }
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

async function* streamChatViaElectron(
  request: ElectronChatStreamRequest,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const electronAPI = window.electronAPI
  if (!electronAPI) {
    throw new Error('Electron API 不可用')
  }

  const streamId = crypto.randomUUID()
  const pendingEvents: ElectronChatStreamEvent[] = []
  let resolveNextEvent: ((event: ElectronChatStreamEvent) => void) | null = null

  const pushEvent = (event: ElectronChatStreamEvent) => {
    if (resolveNextEvent) {
      const resolve = resolveNextEvent
      resolveNextEvent = null
      resolve(event)
      return
    }

    pendingEvents.push(event)
  }

  const nextEvent = () => {
    if (pendingEvents.length > 0) {
      return Promise.resolve(pendingEvents.shift()!)
    }

    return new Promise<ElectronChatStreamEvent>((resolve) => {
      resolveNextEvent = resolve
    })
  }

  const subscriptionId = electronAPI.subscribeChatStreamEvents((event) => {
    if (event.streamId !== streamId) return
    pushEvent(event)
  })

  const handleAbort = () => {
    void electronAPI.cancelChatStream(streamId)
  }

  signal?.addEventListener('abort', handleAbort)

  try {
    if (signal?.aborted) {
      throw createAbortError()
    }

    await electronAPI.startChatStream({ streamId, ...request })

    while (true) {
      const event = await nextEvent()

      if (event.type === 'chunk') {
        yield event.chunk
        continue
      }

      if (event.type === 'done') {
        return
      }

      if (event.type === 'aborted') {
        throw createAbortError()
      }

      throw new ChatApiError(event.message, event.status)
    }
  } finally {
    electronAPI.unsubscribeChatStreamEvents(subscriptionId)
    signal?.removeEventListener('abort', handleAbort)
  }
}

export async function* streamChat(
  config: ApiConfig,
  messages: Message[],
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  signal?: AbortSignal,
  referenceContext?: string
): AsyncGenerator<string, void, unknown> {
  const apiMessages = buildApiMessages(messages, systemPrompt, config.multimodal, referenceContext)

  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/chat/completions`

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: apiMessages,
    stream: true,
    temperature,
  }
  if (maxTokens > 0) {
    requestBody.max_tokens = maxTokens
  }

  if (window.electronAPI?.startChatStream) {
    yield* streamChatViaElectron(
      {
        baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages: apiMessages,
        temperature,
        maxTokens,
      },
      signal
    )
    return
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!response.ok) {
    const { message: errorMsg } = await parseApiErrorResponse(response)
    throw new ChatApiError(errorMsg, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new ChatApiError('无法读取响应流')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  const parseStreamLine = (line: string): ParsedStreamLine | null => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data: ')) return null

    const data = trimmed.slice(6)
    if (data === '[DONE]') {
      return { isDone: true }
    }

    try {
      const chunk: ChatCompletionChunk = JSON.parse(data)
      return {
        chunk,
        content: chunk.choices[0]?.delta?.content,
        isDone: false,
      }
    } catch {
      return null
    }
  }

  try {
    let streamEnded = false

    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const parsed = parseStreamLine(line)
        if (!parsed) continue

        if (parsed.isDone) {
          streamEnded = true
          break
        }

        if (parsed.content) {
          yield parsed.content
        }
      }

      if (streamEnded) return
      if (done) break
    }

    const trailingLine = buffer.trim()
    if (trailingLine) {
      const parsed = parseStreamLine(trailingLine)
      if (parsed?.content) {
        yield parsed.content
      }
      if (parsed?.isDone) {
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function parseSpreadsheetIntent(
  config: ApiConfig,
  userInstruction: string,
  spreadsheetSummary: string,
  spreadsheetSchema?: SpreadsheetWorkbookSchema,
  recentContext?: string,
  signal?: AbortSignal
): Promise<SpreadsheetIntentParseResult | null> {
  const systemPrompt = [
    '你是一个表格指令解析器。',
    '你的任务是把用户针对 CSV/XLSX 的自然语言请求，转成可执行的规范化中文指令。',
    '优先利用已有上下文理解用户口语、省略、指代和续问。',
    '如果用户是在要求筛选、分组、统计、求和、平均、计数、生成新工作表、生成图表、导出、排序、选列、或复杂表格改造，则 shouldExecute=true。',
    '如果只是普通问答、解释结果、闲聊，则 shouldExecute=false。',
    '如果用户用了口语化表达，比如“有多少”“做个图”“顺便画个图”“按刚才那个结果画一下”“导出来”，也要尽量改写成可执行指令。',
    '如果用户提到“人数”“多少人”“每个部门多少人”，通常应理解为 count 计数。',
    '如果用户没有明确图表类型但明确要画图，默认改写成“生成柱状图”。',
    '如果用户没有重复说明分组字段，但最近上下文里已有刚生成的统计结果，可以沿用最近那次统计意图。',
    '只输出 JSON，不要输出额外解释。',
    'JSON 结构必须是：{"shouldExecute":boolean,"normalizedInstruction":string,"plan":{...}}',
    'plan 字段用于结构化执行，字段可包括：intent, sourceSheetName, groupByColumns, valueColumn, filters, selectColumns, sortBy, sortDirection, chartType, targetSheetName, useLastCreatedSheet, topN, script。',
    'filters 里的 operator 只能是 eq / contains / gt / gte / lt / lte。',
    'intent 只能是 count / sum / avg / chart / export / script / filter_rows。',
    '只有当内建操作明显不够时，才使用 script。script.language 只能是 javascript。',
    'script 只能基于受限 API 操作当前表格，会话外文件、网络、系统命令都不可用。',
    'normalizedInstruction 要尽量改写成这种格式：',
    '- 单据状态=单据未完成，按责任人计数，生成柱状图',
    '- 金额>1000，按部门+责任人汇总金额，生成新工作表',
    '- 备注包含返工，按责任人统计金额平均值',
    '- 客户原因包含客户待下，筛选完整明细，输出新工作表',
    'plan 示例：{"intent":"count","groupByColumns":["责任人"],"filters":[{"column":"单据状态","operator":"eq","value":"单据未完成"}],"chartType":"bar"}',
    '筛选明细示例：{"intent":"filter_rows","filters":[{"column":"客户原因","operator":"contains","value":"客户待下"}],"targetSheetName":"客户待下明细"}',
    '如果用户说“把部门人数最多的前三个列出来并生成图表”，优先输出原生计划：{"intent":"count","groupByColumns":["部门"],"topN":3,"chartType":"bar"}，不要用 script。',
    '如果用户说“把刚才那个结果画成饼图”，可以输出：{"intent":"chart","chartType":"pie","useLastCreatedSheet":true}',
    '如果用户说“导出这个结果”，可以输出：{"intent":"export","useLastCreatedSheet":true}',
    '如果用户要复杂改造，可输出 script，例如：{"intent":"script","script":{"language":"javascript","summary":"清洗部门列并输出新表","code":"const rows = api.readSheet(); const header = rows[0]; ...; return { message: \"已完成\" }"}}',
  ].join('\n')

  const userPrompt = [
    `用户原始请求：${userInstruction}`,
    '',
    ...(recentContext ? ['最近上下文：', recentContext, ''] : []),
    ...(spreadsheetSchema ? ['表格结构(JSON)：', JSON.stringify(spreadsheetSchema), ''] : []),
    '表格摘要：',
    spreadsheetSummary,
  ].join('\n')

  let content: string | undefined
  if (window.electronAPI?.completeChat) {
    try {
      content = await window.electronAPI.completeChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: 0,
        maxTokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
    } catch {
      return null
    }
  } else {
    const baseUrl = config.baseUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 300,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal,
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    content = payload.choices?.[0]?.message?.content?.trim()
  }

  if (!content) return null

  const parsed = extractJsonObject(content)
  if (!parsed) return null

  return {
    shouldExecute: Boolean(parsed.shouldExecute),
    normalizedInstruction: typeof parsed.normalizedInstruction === 'string'
      ? parsed.normalizedInstruction.trim()
      : undefined,
    plan: parsed.plan && typeof parsed.plan === 'object'
      ? parsed.plan as SpreadsheetExecutionPlan
      : undefined,
  }
}

/** Non-streaming test call to verify API config */
export async function testApiConnection(config: { baseUrl: string; apiKey: string }): Promise<ApiConnectionTestResult> {
  if (window.electronAPI?.testApiConnection) {
    return window.electronAPI.testApiConnection(config)
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/models`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    })

    if (response.ok) {
      return { ok: true, status: response.status }
    }

    const { message } = await parseApiErrorResponse(response)
    return {
      ok: false,
      status: response.status,
      error: message,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '连接失败',
    }
  }
}
