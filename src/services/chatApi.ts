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
  searchContext?: string
): Array<{ role: string; content: string | ContentPart[] }> {
  // Inject search context into system prompt if provided
  const enhancedSystemPrompt = searchContext 
    ? `${systemPrompt}\n\n以下是网络搜索结果，请在回答时引用相关来源（使用 [1], [2] 等标记）：\n\n${searchContext}`
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

export async function* streamChat(
  config: ApiConfig,
  messages: Message[],
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
  signal?: AbortSignal,
  searchContext?: string
): AsyncGenerator<string, void, unknown> {
  const apiMessages = buildApiMessages(messages, systemPrompt, config.multimodal, searchContext)

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

  // Log request
  console.group('%c[API Request] %c→ %s', 'color:#5c7cfa;font-weight:bold', 'color:#64748b', `${config.model} @ ${baseUrl}`)
  console.log('%cURL:   %c%s', 'color:#8494b2', 'color:#e8ecf4', url)
  console.log('%cBody:', 'color:#8494b2')
  console.dir(requestBody, { depth: null })
  console.groupEnd()

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
    let errorMsg = `API 请求失败 (${response.status})`
    let errorBody: unknown = null
    try {
      errorBody = await response.json()
      errorMsg = (errorBody as Record<string, Record<string, string>>)?.error?.message ?? errorMsg
    } catch {
      // ignore parse error
    }
    console.group('%c[API Error] %c← %s', 'color:#ef4444;font-weight:bold', 'color:#64748b', response.status)
    if (errorBody) console.dir(errorBody, { depth: null })
    else console.log(errorMsg)
    console.groupEnd()
    throw new ChatApiError(errorMsg, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new ChatApiError('无法读取响应流')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let fullResponse = ''
  const chunks: ChatCompletionChunk[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          // Log complete response
          console.group('%c[API Response] %c← %s %c(%d chunks)', 'color:#10b981;font-weight:bold', 'color:#64748b', config.model, 'color:#8494b2', chunks.length)
          console.log('%cFull content:', 'color:#8494b2')
          console.log(fullResponse)
          console.log('%cLast chunk:', 'color:#8494b2')
          if (chunks.length > 0) console.dir(chunks[chunks.length - 1], { depth: null })
          console.groupEnd()
          return
        }

        try {
          const chunk: ChatCompletionChunk = JSON.parse(data)
          chunks.push(chunk)
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            fullResponse += content
            yield content
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    // Stream ended without [DONE] — still log
    if (fullResponse) {
      console.group('%c[API Response] %c← %s %c(%d chunks, no [DONE])', 'color:#f59e0b;font-weight:bold', 'color:#64748b', config.model, 'color:#8494b2', chunks.length)
      console.log('%cFull content:', 'color:#8494b2')
      console.log(fullResponse)
      console.groupEnd()
    }
  } finally {
    reader.releaseLock()
  }
}

/** Non-streaming test call to verify API config */
export async function testApiConnection(config: { baseUrl: string; apiKey: string }): Promise<boolean> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const url = `${baseUrl}/models`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  })

  return response.ok
}
