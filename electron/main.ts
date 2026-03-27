import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import path from 'path'
import { extractDocumentText, type ExtractDocumentTextRequest } from './documentExtraction.ts'

let mainWindow: BrowserWindow | null = null
const activeApiStreams = new Map<string, AbortController>()

const APP_AMPERSAND_RE = /&(?:amp(?:;|%3[Bb])|#38;)/gi
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const READABLE_WEB_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']
const MAX_WEB_PAGE_CHARS = 500000
const WEB_FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KatopGPT/1.0 Chrome/124.0.0.0 Safari/537.36'

type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface ApiChatMessage {
  role: string
  content: string | ApiContentPart[]
}

interface ApiConnectionConfig {
  baseUrl: string
  apiKey: string
}

interface ApiConnectionTestResult {
  ok: boolean
  status?: number
  error?: string
}

interface StartChatStreamRequest {
  streamId: string
  baseUrl: string
  apiKey: string
  model: string
  messages: ApiChatMessage[]
  temperature: number
  maxTokens: number
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

interface ChatCompletionResponseChoice {
  delta?: { content?: unknown }
  message?: { content?: unknown }
  text?: unknown
}

interface ChatCompletionResponse {
  choices?: ChatCompletionResponseChoice[]
}

type ChatStreamEvent =
  | { streamId: string; type: 'chunk'; chunk: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string; status?: number }
  | { streamId: string; type: 'aborted' }

function normalizeExternalUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null

  const normalizedUrl = trimmedUrl.replace(APP_AMPERSAND_RE, '&')

  try {
    const url = new URL(normalizedUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function openExternalUrl(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) return false
  void shell.openExternal(externalUrl)
  return true
}

function normalizeApiBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function extractApiErrorMessage(errorBody: unknown, fallback: string) {
  if (!errorBody || typeof errorBody !== 'object') return fallback

  const body = errorBody as Record<string, unknown>
  const error = body.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }

  const message = body.message
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }

  return fallback
}

function shortenText(text: string, maxLength: number = 300) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}...`
}

async function readApiError(response: Response) {
  const fallback = `API 请求失败 (${response.status})`

  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const errorBody = await response.json()
      return {
        message: extractApiErrorMessage(errorBody, fallback),
        body: errorBody,
      }
    }

    const text = shortenText((await response.text()).trim())
    return {
      message: text || fallback,
    }
  } catch {
    return {
      message: fallback,
    }
  }
}

function parseStreamLine(line: string): ParsedStreamLine | null {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('data:')) return null

  const data = trimmed.slice(5).trimStart()
  if (data === '[DONE]') {
    return { isDone: true }
  }

  try {
    const chunk: ChatCompletionChunk = JSON.parse(data)
    return {
      chunk,
      content: extractCompletionText(chunk) ?? undefined,
      isDone: false,
    }
  } catch {
    return null
  }
}

function extractTextFromMessageContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const textValue = (part as Record<string, unknown>).text
        return typeof textValue === 'string' ? textValue : ''
      })
      .join('')

    return text || null
  }

  return null
}

function extractCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const choices = (payload as ChatCompletionResponse).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }

  const firstChoice = choices[0]
  const candidates = [
    extractTextFromMessageContent(firstChoice?.delta?.content),
    extractTextFromMessageContent(firstChoice?.message?.content),
    typeof firstChoice?.text === 'string' ? firstChoice.text : null,
  ]

  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null
}

function formatRawResponsePreview(rawText: string, maxLength: number = 300) {
  const normalized = rawText
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()

  if (!normalized) {
    return '（上游响应为空）'
  }

  return shortenText(normalized, maxLength)
}

function buildUnparsedResponseError(rawText: string) {
  return `模型已返回响应，但未解析出可显示文本。上游原始响应预览：${formatRawResponsePreview(rawText)}`
}

function extractCompletionTextFromRaw(rawText: string): string | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const text = extractCompletionText(parsed)
    if (text) return text
  } catch {
    // ignore JSON parse error
  }

  let mergedText = ''
  for (const line of trimmed.split(/\r?\n/)) {
    const parsed = parseStreamLine(line)
    if (parsed?.content) {
      mergedText += parsed.content
    }
  }

  return mergedText || null
}

async function relayNonStreamCompletionResponse(sender: WebContents, streamId: string, response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const rawText = await response.text()

  if (contentType.includes('application/json')) {
    try {
      const payload = JSON.parse(rawText)
      const text = extractCompletionText(payload)
      if (!text) {
        throw new Error(buildUnparsedResponseError(rawText))
      }

      sendChatStreamEvent(sender, { streamId, type: 'chunk', chunk: text })
      sendChatStreamEvent(sender, { streamId, type: 'done' })
      return
    } catch (error) {
      if (error instanceof Error && error.message.includes('上游原始响应预览')) {
        throw error
      }

      throw new Error(buildUnparsedResponseError(rawText))
    }
  }

  const text = extractCompletionTextFromRaw(rawText)
  if (!text) {
    throw new Error(buildUnparsedResponseError(rawText))
  }

  sendChatStreamEvent(sender, { streamId, type: 'chunk', chunk: text })
  sendChatStreamEvent(sender, { streamId, type: 'done' })
}

function sendChatStreamEvent(sender: WebContents, payload: ChatStreamEvent) {
  if (sender.isDestroyed()) return
  sender.send('api:chatStreamEvent', payload)
}

async function testApiConnection(config: ApiConnectionConfig): Promise<ApiConnectionTestResult> {
  const baseUrl = normalizeApiBaseUrl(config.baseUrl)
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

    const { message } = await readApiError(response)
    return { ok: false, status: response.status, error: message }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '连接失败',
    }
  }
}

async function proxyChatStream(
  sender: WebContents,
  request: StartChatStreamRequest,
  abortController: AbortController
) {
  const baseUrl = normalizeApiBaseUrl(request.baseUrl)
  const url = `${baseUrl}/chat/completions`
  const requestBody: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    temperature: request.temperature,
  }

  if (request.maxTokens > 0) {
    requestBody.max_tokens = request.maxTokens
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    })

    if (!response.ok) {
      const { message } = await readApiError(response)
      sendChatStreamEvent(sender, {
        streamId: request.streamId,
        type: 'error',
        message,
        status: response.status,
      })
      return
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !contentType.includes('text/event-stream')) {
      await relayNonStreamCompletionResponse(sender, request.streamId, response)
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      sendChatStreamEvent(sender, {
        streamId: request.streamId,
        type: 'error',
        message: '无法读取响应流',
      })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let rawResponse = ''
    let hasVisibleContent = false

    try {
      let streamEnded = false

      while (true) {
        const { done, value } = await reader.read()
        const chunkText = done ? decoder.decode() : decoder.decode(value, { stream: true })
        rawResponse += chunkText
        buffer += chunkText
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const parsed = parseStreamLine(line)
          if (!parsed) continue

          if (parsed.isDone) {
            sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
            streamEnded = true
            break
          }

          if (parsed.content) {
            hasVisibleContent = true
            sendChatStreamEvent(sender, {
              streamId: request.streamId,
              type: 'chunk',
              chunk: parsed.content,
            })
          }
        }

        if (streamEnded) return
        if (done) break
      }

      const trailingLine = buffer.trim()
      if (trailingLine) {
        const parsed = parseStreamLine(trailingLine)
        if (parsed?.content) {
          hasVisibleContent = true
          sendChatStreamEvent(sender, {
            streamId: request.streamId,
            type: 'chunk',
            chunk: parsed.content,
          })
        }
        if (parsed?.isDone) {
          sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
          return
        }
      }

      if (!hasVisibleContent) {
        const fallbackText = extractCompletionTextFromRaw(rawResponse)
        if (fallbackText) {
          sendChatStreamEvent(sender, {
            streamId: request.streamId,
            type: 'chunk',
            chunk: fallbackText,
          })
          sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
          return
        }

        sendChatStreamEvent(sender, {
          streamId: request.streamId,
          type: 'error',
          message: buildUnparsedResponseError(rawResponse),
        })
        return
      }

      sendChatStreamEvent(sender, { streamId: request.streamId, type: 'done' })
    } finally {
      reader.releaseLock()
    }
  } catch (error) {
    if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      sendChatStreamEvent(sender, { streamId: request.streamId, type: 'aborted' })
      return
    }

    sendChatStreamEvent(sender, {
      streamId: request.streamId,
      type: 'error',
      message: error instanceof Error ? error.message : '请求失败',
    })
  } finally {
    activeApiStreams.delete(request.streamId)
  }
}

async function fetchWebPage(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) {
    throw new Error('无效网页链接')
  }

  const response = await fetch(externalUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': WEB_FETCH_USER_AGENT,
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`网页请求失败 (${response.status})`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const isReadableContent = READABLE_WEB_CONTENT_TYPES.some((type) => contentType.includes(type))
  if (contentType && !isReadableContent) {
    throw new Error(`暂不支持读取该网页类型：${contentType}`)
  }

  const html = (await response.text()).slice(0, MAX_WEB_PAGE_CHARS)

  return {
    finalUrl: normalizeExternalUrl(response.url) ?? externalUrl,
    contentType,
    html,
  }
}

function isAppUrl(url: string) {
  if (url.startsWith('file://')) return true
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
    return true
  }
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url)) {
      return { action: 'deny' }
    }

    if (url.startsWith('data:') || url === 'about:blank') {
      return { action: 'allow' }
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return

    event.preventDefault()
    openExternalUrl(url)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  activeApiStreams.forEach((controller) => controller.abort())
  activeApiStreams.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())
ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url))
ipcMain.handle('web:fetchPage', (_event, url: string) => fetchWebPage(url))
ipcMain.handle('files:extractDocumentText', (_event, request: ExtractDocumentTextRequest) => extractDocumentText(request))
ipcMain.handle('api:testConnection', (_event, config: ApiConnectionConfig) => testApiConnection(config))
ipcMain.handle('api:startChatStream', (event, request: StartChatStreamRequest) => {
  if (activeApiStreams.has(request.streamId)) {
    throw new Error('聊天流已存在')
  }

  const abortController = new AbortController()
  activeApiStreams.set(request.streamId, abortController)
  void proxyChatStream(event.sender, request, abortController)
  return true
})
ipcMain.handle('api:cancelChatStream', (_event, streamId: string) => {
  const controller = activeApiStreams.get(streamId)
  if (!controller) return false
  controller.abort()
  return true
})
