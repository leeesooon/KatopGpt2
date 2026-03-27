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
        return `${label}\n\`\`\`\n${f.content}\n\`\`\``
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
